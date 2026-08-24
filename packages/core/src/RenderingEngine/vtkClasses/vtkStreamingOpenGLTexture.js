import macro from '@kitware/vtk.js/macros';
import vtkOpenGLTexture from '@kitware/vtk.js/Rendering/OpenGL/Texture';
import cache from '../../cache/cache';
import { getConstructorFromType } from '../../utilities/getBufferConfiguration';

/**
 * Converts the input data array to the specified data type
 * @param {TypedArray} data - The source data array
 * @param {string} targetDataType - The target data type to convert to
 * @returns {TypedArray} The converted data array
 */
function convertDataType(data, targetDataType) {
  const Constructor = getConstructorFromType(targetDataType);
  const convertedData = new Constructor(data.length);
  convertedData.set(data);
  return convertedData;
}

/**
 * vtkStreamingOpenGLTexture - A derived class of the core vtkOpenGLTexture.
 * This class has methods to update the texture memory on the GPU slice by slice
 * in an efficient yet GPU-architecture friendly manner.
 *
 *
 * @param {*} publicAPI The public API to extend
 * @param {*} model The private model to extend.
 */
function vtkStreamingOpenGLTexture(publicAPI, model) {
  model.classHierarchy.push('vtkStreamingOpenGLTexture');

  model.updatedFrames = [];
  model.volumeId = null;

  const superCreate3DFilterableFromRaw = publicAPI.create3DFilterableFromRaw;

  publicAPI.create3DFilterableFromRaw = ({
    width,
    height,
    depth,
    numberOfComponents,
    numComps,
    dataType,
    data,
    preferSizeOverAccuracy,
    updatedExtents,
  }) => {
    const resolvedNumComps = numberOfComponents ?? numComps;
    model.inputDataType = dataType;
    model.inputNumComps = resolvedNumComps;

    if (data === null) {
      publicAPI.getOpenGLDataType(dataType);
      const isExactHalfFloat = !!preferSizeOverAccuracy;
      let useHalfFloat = false;

      if (model._openGLRenderWindow.getWebgl2()) {
        const forceHalfFloat =
          model.openGLDataType === model.context.FLOAT &&
          model.context.getExtension('OES_texture_float_linear') === null &&
          isExactHalfFloat;
        useHalfFloat =
          forceHalfFloat || model.openGLDataType === model.context.HALF_FLOAT;
      } else {
        const halfFloatExt = model.context.getExtension(
          'OES_texture_half_float'
        );
        useHalfFloat =
          !!halfFloatExt &&
          model.openGLDataType === halfFloatExt.HALF_FLOAT_OES;
      }

      model.canUseHalfFloat = useHalfFloat && isExactHalfFloat;
      publicAPI.create3DFromRaw({
        width,
        height,
        depth,
        numComps: resolvedNumComps,
        dataType,
        data: null,
        updatedExtents,
      });
      return;
    }

    superCreate3DFilterableFromRaw({
      width,
      height,
      depth,
      numComps: resolvedNumComps,
      dataType,
      data,
      preferSizeOverAccuracy,
    });
  };

  const superUpdate = publicAPI.updateVolumeInfoForGL;

  publicAPI.updateVolumeInfoForGL = (dataType, numComps) => {
    const isScalingApplied = superUpdate(dataType, numComps);
    const volume = model.volumeId ? cache.getVolume(model.volumeId) : null;
    const range = volume?.voxelManager?.getRange?.();
    const min = Array.isArray(range) ? range[0] : 0;
    const max = Array.isArray(range) ? range[1] : 0;
    const scale =
      Number.isFinite(max) && Number.isFinite(min) ? max - min || 1 : 1;
    const offset = Number.isFinite(min) ? min : 0;
    const n = Math.max(1, Math.min(numComps ?? 1, 4));
    model.volumeInfo.dataComputedScale = new Array(n).fill(scale);
    model.volumeInfo.dataComputedOffset = new Array(n).fill(offset);
    return isScalingApplied;
  };

  /**
   * This function updates the GPU texture memory to match the current
   * representation of data held in RAM.
   *
   */
  publicAPI.update3DFromRaw = () => {
    const { volumeId } = model;

    if (!volumeId) {
      return;
    }

    const volume = cache.getVolume(volumeId);

    if (!volume) {
      return;
    }

    model._openGLRenderWindow.activateTexture(publicAPI);
    publicAPI.createTexture();
    publicAPI.bind();

    if (volume.isDynamicVolume()) {
      updateDynamicVolumeTexture();
      return;
    }

    return (
      publicAPI.hasUpdatedFrames() && updateTextureImagesUsingVoxelManager()
    );
  };

  /**
   * Called when a frame is loaded so that on next render we know which data to load in.
   * @param {number} frameIndex The frame to load in.
   */
  const superModified = publicAPI.modified;
  publicAPI.setUpdatedFrame = (frameIndex) => {
    model.updatedFrames[frameIndex] = true;
    superModified();
  };

  publicAPI.modified = () => {
    superModified();

    // this is really not efficient, but it works for now
    const volume = cache.getVolume(model.volumeId);

    if (!volume) {
      return;
    }

    const imageIds = volume.imageIds;

    for (let i = 0; i < imageIds.length; i++) {
      model.updatedFrames[i] = true;
    }
  };

  function updateTextureImagesUsingVoxelManager() {
    const volume = cache.getVolume(model.volumeId);
    const imageIds = volume.imageIds;
    for (let i = 0; i < model.updatedFrames.length; i++) {
      if (model.updatedFrames[i]) {
        // find the updated frames
        const image = cache.getImage(imageIds[i]);
        if (!image) {
          // console.debug('image not found', imageIds[i]);
          continue;
        }

        let data = image.voxelManager.getScalarData();
        const gl = model.context;

        if (volume.dataType !== data.constructor.name) {
          data = convertDataType(data, volume.dataType);
        }

        const [pixData] = publicAPI.updateArrayDataTypeForGL(volume.dataType, [
          data,
        ]);

        // Bind the texture
        publicAPI.bind();

        // Calculate the offset within the 3D texture
        const zOffset = i;

        // Update the texture sub-image
        // Todo: need to check other systems if it can handle it
        gl.texSubImage3D(
          model.target, // target
          0, // level
          0, // xoffset
          0, // yoffset
          zOffset, // zoffset
          model.width, // width
          model.height, // height
          1, // depth (1 slice)
          model.format, // format
          model.openGLDataType, // type
          pixData // data
        );

        // Unbind the texture
        publicAPI.deactivate();
        // Reset the updated flag
        model.updatedFrames[i] = null;
      }
    }

    if (model.generateMipmap) {
      model.context.generateMipmap(model.target);
    }

    publicAPI.deactivate();
    return true;
  }

  function updateDynamicVolumeTexture() {
    const volume = cache.getVolume(model.volumeId);

    // loop over imageIds of the current time point and update the texture
    const imageIds = volume.getCurrentDimensionGroupImageIds();

    if (!imageIds.length) {
      return false;
    }

    let constructor;

    for (let i = 0; i < imageIds.length; i++) {
      const imageId = imageIds[i];
      const image = cache.getImage(imageId);

      let data;
      if (!image) {
        // if there is no data we should set zero
        constructor = getConstructorFromType(volume.dataType, true);
        data = new constructor(model.width * model.height);
      } else {
        data = image.voxelManager.getScalarData();
        constructor = data.constructor;
      }

      const gl = model.context;

      if (volume.dataType !== data.constructor.name) {
        data = convertDataType(data, volume.dataType);
      }

      const [pixData] = publicAPI.updateArrayDataTypeForGL(volume.dataType, [
        data,
      ]);

      // Bind the texture
      publicAPI.bind();

      // Calculate the offset within the 3D texture
      let zOffset = i;

      // Update the texture sub-image
      // Todo: need to check other systems if it can handle it
      gl.texSubImage3D(
        model.target, // target
        0, // level
        0, // xoffset
        0, // yoffset
        zOffset, // zoffset
        model.width, // width
        model.height, // height
        1, // depth (1 slice)
        model.format, // format
        model.openGLDataType, // type
        pixData // data
      );

      // Unbind the texture
      publicAPI.deactivate();
      // Reset the updated flag
    }

    if (model.generateMipmap) {
      model.context.generateMipmap(model.target);
    }

    publicAPI.deactivate();
    return true;
  }

  publicAPI.hasUpdatedFrames = () =>
    !model.updatedFrames.length || model.updatedFrames.some((frame) => frame);

  publicAPI.getUpdatedFrames = () => model.updatedFrames;

  publicAPI.setVolumeId = (volumeId) => {
    model.volumeId = volumeId;
  };

  publicAPI.getVolumeId = () => model.volumeId;

  publicAPI.setTextureParameters = ({
    width,
    height,
    depth,
    numberOfComponents,
    dataType,
  }) => {
    model.width ??= width;
    model.height ??= height;
    model.depth ??= depth;
    model.inputNumComps ??= numberOfComponents;
    model.inputDataType ??= dataType;
  };

  publicAPI.getTextureParameters = () => ({
    width: model.width,
    height: model.height,
    depth: model.depth,
    numberOfComponents: model.inputNumComps,
    dataType: model.inputDataType,
  });
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  updatedFrames: [],
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  vtkOpenGLTexture.extend(publicAPI, model, initialValues);

  // Object methods
  vtkStreamingOpenGLTexture(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkStreamingOpenGLTexture'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
