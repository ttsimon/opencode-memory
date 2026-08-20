# OpenCode Memory

OpenCode Memory is an early-stage OpenCode plugin intended to provide local-only persistent memory for user preferences, project facts, decisions, and task continuity.

## Project status

The current package contains only a health skeleton that confirms the plugin is loaded. Memory features are not yet released. Do not rely on this version to store, recall, search, import, or manage memory.

The planned memory system will keep data on the user's machine and will not require an external memory service. That local-only goal describes the intended product architecture, not functionality available in the current package.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [docs/architecture.md](docs/architecture.md) for the current architectural boundaries.

## License

OpenCode Memory is available under the [MIT License](LICENSE).
