import type { Migration } from "./database"

export const migrations: readonly Migration[] = [
  {
    version: 1,
    up(database) {
      database.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('preference', 'rule', 'fact', 'decision', 'insight', 'task')),
          content TEXT NOT NULL,
          normalized_content TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived', 'deleted')),
          confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
          importance REAL NOT NULL CHECK (importance BETWEEN 0 AND 1),
          source_session_id TEXT,
          source_message_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_recalled_at TEXT,
          recall_count INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT,
          supersedes_id TEXT REFERENCES memories(id),
          conflict_key TEXT,
          CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
        );

        CREATE UNIQUE INDEX memories_source_unique
          ON memories(source_session_id, source_message_id, kind, normalized_content)
          WHERE source_session_id IS NOT NULL AND source_message_id IS NOT NULL;
        CREATE INDEX memories_scope_status ON memories(scope, project_id, status);
        CREATE INDEX memories_conflict_key ON memories(project_id, conflict_key, status);

        CREATE VIRTUAL TABLE memory_fts USING fts5(
          content,
          kind,
          scope,
          project_id UNINDEXED,
          content='memories',
          content_rowid='rowid'
        );

        CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
          INSERT INTO memory_fts(rowid, content, kind, scope, project_id)
          VALUES (new.rowid, new.content, new.kind, new.scope, new.project_id);
        END;
        CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, content, kind, scope, project_id)
          VALUES ('delete', old.rowid, old.content, old.kind, old.scope, old.project_id);
        END;
        CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, content, kind, scope, project_id)
          VALUES ('delete', old.rowid, old.content, old.kind, old.scope, old.project_id);
          INSERT INTO memory_fts(rowid, content, kind, scope, project_id)
          VALUES (new.rowid, new.content, new.kind, new.scope, new.project_id);
        END;

        CREATE TABLE task_snapshots (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          goal TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived')),
          completed_json TEXT NOT NULL,
          in_progress_json TEXT NOT NULL,
          files_json TEXT NOT NULL,
          decisions_json TEXT NOT NULL,
          blockers_json TEXT NOT NULL,
          next_steps_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          source_session_id TEXT NOT NULL
        );
        CREATE UNIQUE INDEX task_snapshots_active_project
          ON task_snapshots(project_id) WHERE status = 'active';

        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          operation TEXT NOT NULL,
          source_session_id TEXT,
          source_message_id TEXT,
          from_status TEXT,
          to_status TEXT,
          summary TEXT NOT NULL,
          reasons_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE processed_events (
          event_key TEXT PRIMARY KEY,
          processed_at TEXT NOT NULL
        );

        CREATE TABLE settings (
          scope_key TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE pending_events (
          event_key TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
    },
  },
]
