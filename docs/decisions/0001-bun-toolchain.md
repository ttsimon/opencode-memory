# ADR 0001: Use Bun As The Project Toolchain

## Status

Accepted

## Context

OpenCode Memory is an OpenCode plugin that targets the Bun runtime. The repository needs one reproducible toolchain for dependency installation, scripts, tests, builds, and package creation. Using different package managers or runtimes for those operations would increase lockfile churn and create avoidable differences between local development and release checks.

## Decision

Use Bun 1.3.14 as the project's package manager, script runner, test runner, build runtime, and package creation tool. Pin the version in repository metadata and run documented development commands through `mise exec -- bun ...` so contributors and automation use the same toolchain.

## Alternatives

- Use Node.js with npm, pnpm, or Yarn for development while targeting Bun at runtime.
- Support multiple package managers and maintain equivalent lockfiles and commands.
- Leave the Bun version unpinned and rely on the contributor's installed version.

## Consequences

- Development and release commands have one supported execution path.
- The lockfile and generated package are produced consistently with the target runtime.
- Contributors must install the pinned Bun version, normally through mise.
- Supporting another runtime or package manager requires an explicit compatibility decision and validation work.
