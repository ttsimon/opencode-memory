import { expect, test } from "bun:test"
import { MemoryService } from "../../src/memory-service"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
import { createDatabaseFixture } from "../helpers/database"

test("new conflicting fact supersedes the old fact with audit history", async () => {
  const fixture = await createDatabaseFixture()
  const repository = new MemoryRepository(fixture.database)
  const service = new MemoryService(fixture.database, repository, new AuditRepository(fixture.database))
  try {
    const base = {
      scope: "project" as const,
      projectId: "p1",
      kind: "fact" as const,
      confidence: 1,
      importance: 0.9,
      conflictKey: "test-runner",
    }
    const old = service.remember({ ...base, content: "Tests use Jest" })
    const current = service.remember({ ...base, content: "Tests use Bun" })
    if (old.outcome === "rejected" || current.outcome === "rejected") throw new Error("unexpected rejection")
    expect(repository.get(old.memory.id)?.status).toBe("superseded")
    expect(repository.get(current.memory.id)?.supersedesId).toBe(old.memory.id)
    expect(service.history().map((event) => event.operation)).toEqual(["create", "supersede", "create"])
  } finally {
    await fixture.close()
  }
})
