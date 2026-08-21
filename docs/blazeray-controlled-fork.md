# BlazeRay Controlled Fork

This branch is the platform baseline consumed by BlazeRay. It is intentionally
separate from the upstream default branch.

## Baseline

- Upstream repository: `cornerstonejs/cornerstone3D`
- Upstream commit: `7034957b10f5e91ad8f4d7978591ef688e262d26`
- Package release: `@cornerstonejs/core@5.8.2`
- Controlled branch: `blazeray/controlled-v5.8.2`

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
