# ADR 0002: Use bun:sqlite For Local Persistence

## Status

Accepted

## Context

The planned memory system is local-only and needs structured persistence, transactions, migrations, audit history, and local full-text search. The storage layer must not require a network service or a separate database installation. The package already targets Bun, which provides a built-in SQLite interface.

## Decision

Use `bun:sqlite` as the persistence API for the planned memory store. SQLite will remain the authoritative structured store on the user's machine, while any Markdown representation will be a derived, readable projection rather than a second source of truth.

## Alternatives

- Store all memory directly in Markdown or JSON files.
- Use a third-party SQLite binding with native installation requirements.
- Require an external database service.
- Use browser-oriented storage such as IndexedDB.

## Consequences

- Persistence remains local and requires no separate database server.
- Transactions, migrations, and full-text search can be implemented with SQLite facilities.
- The storage implementation is coupled to Bun and must be tested against the pinned Bun version.
- Database schema evolution requires explicit migrations, backups, and recovery behavior.
- Memory persistence is still unreleased; this decision defines the implementation direction rather than claiming current functionality.
