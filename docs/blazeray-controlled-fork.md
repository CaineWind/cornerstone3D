# BlazeRay Controlled Fork

This branch is the platform baseline consumed by BlazeRay. It is intentionally
separate from the upstream default branch.

## Baseline

- Upstream repository: `cornerstonejs/cornerstone3D`
- Upstream commit: `97a426db86a966dd6c001f792dee487b70d90f4d`
- Package release: `@cornerstonejs/core@5.6.11`
- Controlled branch: `blazeray/controlled-v5.6.11`

## Admission Rules

Every delta must describe its upstream context, owner, tests, and removal
condition. Public platform APIs must not expose BlazeRay runtime objects.

The required staged attachment API must preserve the active projection while a
candidate attachment is prepared and validated. It must provide exact
`commit` and `abort` behavior. A failed candidate must not mutate the active
binding, render mode, or viewport identity.

## Release Rules

Packages from this branch must use a distinct internal prerelease version and
be published as one compatible family: core, tools, loaders, metadata, and
utils. BlazeRay must pin those exact versions and record the upstream SHA in
its release manifest.
