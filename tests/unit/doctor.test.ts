import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
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

test("doctor detects missing FTS triggers", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-doctor-fts-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")
  const database = await openDatabase(paths)
  try {
    database.raw.exec("DROP TRIGGER memories_fts_update")
    const report = await new MemoryDoctor(database, paths).run({
      projectId: "a".repeat(32),
      root,
      identity: `path:${root}`,
      kind: "path",
    })
    expect(report.checks.find((check) => check.name === "fts")?.status).toBe("error")
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("doctor recognizes a current projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-doctor-projection-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")
  const database = await openDatabase(paths)
  const projectId = "b".repeat(32)
  try {
    await mkdir(`${paths.projects}/${projectId}`, { recursive: true })
    await Bun.write(`${paths.projects}/${projectId}/MEMORY.md`, "Generated from SQLite\n")
    const report = await new MemoryDoctor(database, paths).run({
      projectId,
      root,
      identity: `path:${root}`,
      kind: "path",
    })
    expect(report.checks.find((check) => check.name === "projection")?.status).toBe("ok")
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("doctor reports inaccessible permissions and projection drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-doctor-drift-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")
  const database = await openDatabase(paths)
  const projectId = "c".repeat(32)
  try {
    database.raw
      .query(
        `INSERT INTO memories (id, scope, project_id, kind, content, normalized_content, status, confidence, importance, created_at, updated_at) VALUES (?, 'project', ?, 'fact', 'Current fact', 'current fact', 'active', 1, 0.9, 'now', 'now')`,
      )
      .run("m1", projectId)
    await mkdir(`${paths.projects}/${projectId}`, { recursive: true })
    await Bun.write(`${paths.projects}/${projectId}/MEMORY.md`, "Generated from SQLite\nMissing current fact\n")
    const missingPaths = { ...paths, root: `${root}/missing-root` }
    const report = await new MemoryDoctor(database, missingPaths).run({
      projectId,
      root,
      identity: `path:${root}`,
      kind: "path",
    })
    expect(report.checks.find((check) => check.name === "permissions")?.status).toBe("error")
    expect(report.checks.find((check) => check.name === "projection")?.status).toBe("warning")
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})
