import { expect, test } from "bun:test"
import { createDatabaseFixture } from "../helpers/database"

test("creates schema version 1 and all required tables", async () => {
  const fixture = await createDatabaseFixture()
  try {
    expect(fixture.database.schemaVersion()).toBe(1)
    expect(fixture.database.tableNames()).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "memories",
        "memory_fts",
        "task_snapshots",
        "audit_events",
        "processed_events",
        "settings",
        "pending_events",
      ]),
    )
    expect(fixture.database.integrityCheck()).toBe("ok")
  } finally {
    await fixture.close()
  }
})

test("keeps FTS synchronized on insert, update and delete", async () => {
  const fixture = await createDatabaseFixture()
  try {
    fixture.database.raw
      .query(`
        INSERT INTO memories (
          id, scope, project_id, kind, content, normalized_content, status,
          confidence, importance, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run("memory-1", "project", "project-1", "fact", "Run bun test", "run bun test", "active", 1, 0.8, "now", "now")

    expect(fixture.database.raw.query("SELECT content FROM memory_fts WHERE memory_fts MATCH 'bun'").get()).toEqual({
      content: "Run bun test",
    })

    fixture.database.raw
      .query("UPDATE memories SET content = ?, normalized_content = ? WHERE id = ?")
      .run("Run bun run check", "run bun run check", "memory-1")
    expect(fixture.database.raw.query("SELECT content FROM memory_fts WHERE memory_fts MATCH 'check'").get()).toEqual({
      content: "Run bun run check",
    })

    fixture.database.raw.query("DELETE FROM memories WHERE id = ?").run("memory-1")
    expect(fixture.database.raw.query("SELECT content FROM memory_fts WHERE memory_fts MATCH 'check'").get()).toBeNull()
  } finally {
    await fixture.close()
  }
})
