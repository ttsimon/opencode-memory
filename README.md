# OpenCode Memory

OpenCode Memory is an early-stage OpenCode plugin intended to provide local-only persistent memory for user preferences, project facts, decisions, and task continuity.

## Project status

The current development branch implements the manual-memory MVP: local SQLite storage, global/project isolation, full-text recall, task snapshots, sensitive-value filtering, audit history, and management commands. Automatic memory extraction and idle-session finalization are still under development and are not yet released.

Memory data remains on the user's machine and does not require an external memory service. The approved engineering baseline is documented in [the repository standards](docs/superpowers/specs/2026-08-20-repository-engineering-standards-design.md).

## MVP commands

- `/memory`
- `/memory-status`
- `/memory-search <query>`
- `/memory-show <id>`
- `/remember <text>`
- `/forget <id or query>`
- `/memory-enable`
- `/memory-disable`

## Compatibility

Development is pinned to OpenCode 1.18.18 and Bun 1.3.14. See [the compatibility matrix](docs/compatibility.md) for the exact support policy.

## Development

Install the pinned toolchain and dependencies:

```sh
mise install
mise exec -- bun install --frozen-lockfile
```

Run the complete project checks:

```sh
mise exec -- bun run check
```

Common focused commands include:

```sh
mise exec -- bun run test:unit
mise exec -- bun run typecheck
mise exec -- bun run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow, [docs/architecture.md](docs/architecture.md) for the current architectural boundaries, and [docs/github-settings.md](docs/github-settings.md) for repository operations.

## License

OpenCode Memory is available under the [MIT License](LICENSE).
