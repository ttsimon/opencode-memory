import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MemoryService } from "../../src/memory-service"
import { resolveDataPaths } from "../../src/paths"
import { MarkdownProjection } from "../../src/projection/markdown"
import { AuditRepository } from "../../src/storage/audit-repository"
import { openDatabase } from "../../src/storage/database"
import { MemoryRepository } from "../../src/storage/memory-repository"

test("rebuilds deterministic project Markdown from stable SQLite records", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-projection-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")
  const database = await openDatabase(paths)
  const repository = new MemoryRepository(database)
  const service = new MemoryService(database, repository, new AuditRepository(database))
  try {
    service.remember({
      scope: "project",
      projectId: "p1",
      kind: "decision",
      content: "Use bun:sqlite",
      confidence: 1,
      importance: 0.9,
    })
    service.remember({
      scope: "project",
      projectId: "p1",
      kind: "fact",
      content: "Temporary port 54321",
      confidence: 1,
      importance: 0.2,
    })
    const projection = new MarkdownProjection(paths, repository)
    await projection.rebuildProject("p1")
    const target = join(paths.projects, "p1", "MEMORY.md")
    expect(await Bun.file(target).text()).toContain("Generated from SQLite")
    expect(await Bun.file(target).text()).toContain("Use bun:sqlite")
    expect(await Bun.file(target).text()).not.toContain("Temporary port")
    await Bun.write(target, "corrupt")
    await projection.rebuildProject("p1")
    expect(await Bun.file(target).text()).toContain("Use bun:sqlite")
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})
