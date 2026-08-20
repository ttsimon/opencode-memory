# Changesets

Changesets record user-visible package changes and drive versioning and changelog generation.

Run `mise exec -- bun run changeset` for a change that affects published behavior. Select `@ttsimon/opencode-memory`, choose the appropriate semantic version impact, and describe the change in release-note language.

Documentation, tests, and repository-only maintenance that do not affect the published package do not require a changeset. Release automation consumes changeset files with `bun run version-packages` and publishes with `bun run release`.
