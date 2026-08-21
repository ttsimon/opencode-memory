# Usage

## Installation status

The package is not published yet. Development and host tests load the built plugin in an isolated OpenCode 1.18.18 environment. After a future installation or configuration change, quit and restart OpenCode because plugins and configuration are loaded at startup.

## Data locations

- Windows: `%LOCALAPPDATA%/opencode-memory`
- macOS: `$HOME/Library/Application Support/opencode-memory`
- Linux: `$XDG_DATA_HOME/opencode-memory`, or `$HOME/.local/share/opencode-memory`

SQLite `memory.db` is the source of truth. `global/MEMORY.md` and `projects/<project-id>/MEMORY.md` are readable projections. Project memory is not written into the repository.

## Commands

- `/memory`: current scope, core memory, recent writes, and active task.
- `/memory-status`: enabled/degraded state and the current session's recall/write status.
- `/memory-search <query>`: search active memories.
- `/memory-show <id>`: show one record.
- `/remember <text>`: classify and save a memory after sensitive-value filtering.
- `/forget <id or query>`: soft-delete one unambiguous record.
- `/memory-enable` and `/memory-disable`: control automatic recall and writes for the current project.
- `/memory-history [id]`: show audit transitions.
- `/memory-doctor`: run non-destructive health checks and recovery recommendations.

## Scope and recall

Explicit cross-project preferences use global scope. Repository rules, decisions, facts, and uncertain scope default to the current project. Recall precedence is current user instructions, repository facts, project memory, global memory, then historical task state.

Default limits are 8 global core preferences, 12 project core rules, 8 dynamic memories, 1 active task, and approximately 2,000 tokens. Deleted, archived, superseded, and expired records are excluded.

## Automatic memory

Explicit persistent preferences, project rules, and confirmed decisions can be saved during a conversation. On `session.idle`, the plugin reads recent session messages, todos, and relevant files to update one active project task snapshot. Compaction context preserves task state, decisions, blockers, risks, files, and next steps.

## Security

API keys, passwords, private keys, credential-bearing connection strings, secret environment assignments, payment data, and identity numbers are rejected before persistence or logs. `/remember` cannot bypass this filter. Rejected audit records contain only reason categories and source identifiers.

## Failure and recovery

Memory failures are fail-open: normal OpenCode conversation and tools continue. Migration backups are stored under `backups/`, with the newest three retained. `/memory-doctor` reports database, FTS, migration, project, permission, and projection status without destructive repair.

This release does not provide `/memory-edit`, `/memory-restore`, `/memory-export`, `/memory-import`, Markdown import, vector search, cloud sync, or automatic destructive repair.
