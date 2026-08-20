# Contributing

Thank you for contributing to opencode-memory. Keep changes focused, reproducible, and safe for local user data.

## Development setup

1. Install the pinned toolchain with `mise install`.
2. Install dependencies with `mise exec -- bun install --frozen-lockfile`.
3. Run the full validation suite with `mise exec -- bun run check`.

Do not update pinned dependency or tool versions as part of an unrelated change.

## Branches and commits

Use short, descriptive branch names such as `feat/search-ranking`, `fix/migration-retry`, or `docs/setup-guide`.

Commit messages must follow Conventional Commits, for example `feat: add memory search filters` or `fix: preserve migration backups`. Keep the header at or below 120 characters.

## Development workflow

Use test-driven development for features and bug fixes:

1. Add a focused test that expresses the required behavior.
2. Run it and confirm it fails for the expected reason.
3. Implement the smallest change that makes it pass.
4. Refactor only while the test suite remains green.

Run `mise exec -- bun run check` before opening a pull request. This command checks formatting, linting, Markdown, types, tests, coverage, the build, and package contents.

E2E tests must be isolated from real OpenCode state. Use temporary directories, synthetic configuration, and disposable databases. Never read or modify a contributor's live OpenCode configuration, memory database, or home-directory state.

Tests and fixtures must never contain real user memory, real user configuration, credentials, tokens, secrets, or copied `.env` contents. Use synthetic data with clearly fake values.

## Pull requests

Keep each pull request limited to one concern. Include a clear summary, test evidence, and any security, OpenCode compatibility, database migration, documentation, or release impact. Add a changeset when the change affects published behavior.

Address review feedback with additional tests when behavior changes. Keep the branch current and ensure all required checks pass before requesting final review.
