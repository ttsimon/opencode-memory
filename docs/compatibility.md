# Compatibility

## Supported toolchain

| Component | Supported version | Policy |
| --- | --- | --- |
| OpenCode | OpenCode 1.18.18 | Exact version used for plugin API and integration validation |
| Bun | Bun 1.3.14 | Exact version used for development, tests, builds, and package checks |

The package currently provides only the plugin health skeleton. Compatibility for unreleased memory storage, recall, lifecycle, and command features is not yet claimed.

## Version policy

OpenCode plugin interfaces can change between releases, so support is limited to the exact OpenCode version listed above until another version is explicitly tested and documented. Bun is pinned through the project toolchain and package metadata to keep development and release checks reproducible.

Changes to either supported version require updating the pinned configuration, dependency metadata, tests, and this matrix in the same change.
