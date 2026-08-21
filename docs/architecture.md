# Architecture

## Current implementation

The current development branch implements the manual-memory MVP. SQLite is the structured source of truth; project resolution, sensitive filtering, FTS recall, task snapshots, audit history, management commands, and fail-open OpenCode hooks are implemented.

Automatic extraction, idle finalization, compaction preservation, conflict replacement, Markdown projection, history commands, and doctor diagnostics remain in the automatic-memory phase.

## Intended boundaries

OpenCode Memory is designed around a local-only architecture. Planned memory data remains on the user's machine and does not depend on a cloud account or external memory service.

The intended system has five responsibilities:

- Project resolution identifies stable global and project scopes without exposing sensitive paths as public identifiers.
- The memory store owns structured records, audit history, migrations, and local full-text search.
- The Markdown projection provides a readable view while the structured store remains authoritative.
- The recall engine ranks, deduplicates, budgets, and injects relevant context.
- The plugin lifecycle connects capture, recall, task continuity, and management operations to supported OpenCode hooks.

## Data and safety principles

The planned implementation follows these constraints:

- Current user instructions and repository facts override historical memory.
- Sensitive values must be rejected before database, Markdown, or log writes.
- Project memory must remain isolated from unrelated projects.
- Failures in optional memory behavior must not prevent normal OpenCode operation.
- Automatic writes must retain enough source and audit information for review.

These principles are design commitments for future work, not claims that memory behavior exists in the current health skeleton.
