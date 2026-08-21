import { expect, test } from "bun:test"
import { classifyManualMemory } from "../../src/domain/classification"
import { MemoryService } from "../../src/memory-service"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
import { createDatabaseFixture } from "../helpers/database"

async function createService() {
  const fixture = await createDatabaseFixture()
  const memories = new MemoryRepository(fixture.database)
  const audit = new AuditRepository(fixture.database)
  return { fixture, memories, audit, service: new MemoryService(fixture.database, memories, audit) }
}

test("manual remember classifies scope and writes one audit event", async () => {
  const context = await createService()
  try {
    const result = context.service.remember({
      ...classifyManualMemory("Always answer me in Chinese", "project-1"),
      sourceSessionId: "s1",
      sourceMessageId: "m1",
    })
    expect(result).toMatchObject({ outcome: "created", memory: { scope: "global", kind: "preference" } })
    expect(context.audit.list()).toHaveLength(1)
  } finally {
    await context.fixture.close()
  }
})

test("same source event is idempotent", async () => {
  const context = await createService()
  try {
    const candidate = {
      ...classifyManualMemory("Tests run with bun test", "project-1"),
      sourceSessionId: "s1",
      sourceMessageId: "m1",
    }
    expect(context.service.remember(candidate).outcome).toBe("created")
    expect(context.service.remember(candidate).outcome).toBe("updated")
    expect(context.memories.count()).toBe(1)
  } finally {
    await context.fixture.close()
  }
})

test("rejects sensitive content before every persistent write", async () => {
  const context = await createService()
  try {
    const result = context.service.remember({
      ...classifyManualMemory("password=hunter2", "project-1"),
      sourceSessionId: "s1",
      sourceMessageId: "m1",
    })
    expect(result).toEqual({ outcome: "rejected", reasons: ["password"] })
    expect(context.memories.count()).toBe(0)
    expect(context.fixture.database.raw.serialize().toString("utf8")).not.toContain("hunter2")
    expect(JSON.stringify(context.audit.list())).not.toContain("hunter2")
  } finally {
    await context.fixture.close()
  }
})

test("ambiguous keyword deletion returns ids without deleting", async () => {
  const context = await createService()
  try {
    context.service.remember(classifyManualMemory("TypeScript uses strict mode", "project-1"))
    context.service.remember(classifyManualMemory("TypeScript files use kebab-case", "project-1"))
    const result = context.service.forget({ query: "TypeScript", projectId: "project-1" })
    expect(result).toMatchObject({ outcome: "ambiguous", ids: [expect.any(String), expect.any(String)] })
    expect(context.memories.listByStatus("deleted")).toHaveLength(0)
  } finally {
    await context.fixture.close()
  }
})

test("forget by id performs a recoverable soft delete", async () => {
  const context = await createService()
  try {
    const created = context.service.remember(classifyManualMemory("Tests use Bun", "project-1"))
    if (created.outcome === "rejected") throw new Error("unexpected rejection")
    expect(context.service.forget({ id: created.memory.id, projectId: "project-1" })).toEqual({
      outcome: "deleted",
      id: created.memory.id,
    })
    expect(context.memories.get(created.memory.id)?.status).toBe("deleted")
    expect(context.audit.list(created.memory.id).at(-1)?.operation).toBe("delete")
  } finally {
    await context.fixture.close()
  }
})

test("search, get and history expose current records", async () => {
  const context = await createService()
  try {
    const created = context.service.remember(classifyManualMemory("Tests use Bun", "project-1"))
    if (created.outcome === "rejected") throw new Error("unexpected rejection")
    expect(context.service.search("Bun", "project-1").map((memory) => memory.id)).toEqual([created.memory.id])
    expect(context.service.get(created.memory.id)?.content).toBe("Tests use Bun")
    expect(context.service.history(created.memory.id).map((event) => event.operation)).toEqual(["create"])
    expect(context.service.forget({ projectId: "project-1" })).toEqual({ outcome: "not_found" })
  } finally {
    await context.fixture.close()
  }
})
