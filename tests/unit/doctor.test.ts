import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MemoryDoctor } from "../../src/diagnostics/doctor"
import { resolveDataPaths } from "../../src/paths"
import { openDatabase } from "../../src/storage/database"

test("doctor checks database, FTS, migration, project, permissions and projection without repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-doctor-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")
  const database = await openDatabase(paths)
  try {
    database.raw.exec("CREATE TABLE doctor_marker (value TEXT)")
    const report = await new MemoryDoctor(database, paths).run({
      projectId: "p1",
      root,
      identity: `path:${root}`,
      kind: "path",
    })
    expect(report.checks.map((check) => check.name)).toEqual([
      "database",
      "fts",
      "migration",
      "project",
      "permissions",
      "projection",
    ])
    expect(database.raw.query("SELECT name FROM sqlite_master WHERE name = 'doctor_marker'").get()).not.toBeNull()
    expect(report.recommendations.join("\n")).toContain("rebuild")
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})
