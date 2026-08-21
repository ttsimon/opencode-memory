import { expect, test } from "bun:test"
import { classifyManualMemory } from "../../src/domain/classification"
import { MemoryService } from "../../src/memory-service"
import { RecallEngine } from "../../src/recall/engine"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
import { TaskRepository } from "../../src/storage/task-repository"
import { createDatabaseFixture } from "../helpers/database"

async function setup() {
  const fixture = await createDatabaseFixture()
  const memories = new MemoryRepository(fixture.database)
  const service = new MemoryService(fixture.database, memories, new AuditRepository(fixture.database))
  const tasks = new TaskRepository(fixture.database)
  const recall = new RecallEngine(memories, tasks)
  return { fixture, memories, service, tasks, recall }
}

test("recalls global preferences and only current-project memories", async () => {
  const context = await setup()
  try {
    context.service.remember(classifyManualMemory("Always answer me in Chinese", "alpha"))
    context.service.remember(classifyManualMemory("Run bun test for this project", "alpha"))
    context.service.remember(classifyManualMemory("Beta deploy command is fly deploy", "beta"))
    const result = context.recall.recall({
      projectId: "alpha",
      query: "How do we run tests?",
      recentTopics: [],
      currentFiles: [],
      now: new Date("2026-08-21T00:00:00.000Z"),
    })
    expect(result.items.map((item) => item.content)).toContain("Always answer me in Chinese")
    expect(result.items.map((item) => item.content)).toContain("Run bun test for this project")
    expect(result.items.map((item) => item.content)).not.toContain("Beta deploy command is fly deploy")
  } finally {
    await context.fixture.close()
  }
})

test("excludes deleted, archived, superseded and expired records", async () => {
  const context = await setup()
  try {
    const active = context.service.remember(classifyManualMemory("Active build command is make verify", "alpha"))
    const deleted = context.service.remember(classifyManualMemory("Deleted build command is legacy verify", "alpha"))
    const expired = context.service.remember({
      ...classifyManualMemory("Expired build command is old-test", "alpha"),
      expiresAt: "2026-08-19T00:00:00.000Z",
    })
    if (deleted.outcome !== "rejected") context.service.forget({ id: deleted.memory.id, projectId: "alpha" })
    if (expired.outcome === "rejected" || active.outcome === "rejected") throw new Error("unexpected rejection")
    context.fixture.database.raw.query("UPDATE memories SET status = 'archived' WHERE id = ?").run(expired.memory.id)
    const result = context.recall.recall({
      projectId: "alpha",
      query: "build command test check old-test",
      recentTopics: [],
      currentFiles: [],
      now: new Date("2026-08-21T00:00:00.000Z"),
    })
    expect(result.items.map((item) => item.id)).toEqual([active.memory.id])
  } finally {
    await context.fixture.close()
  }
})

test("enforces item and token budgets and updates injected metadata", async () => {
  const context = await setup()
  try {
    for (let index = 0; index < 30; index += 1) {
      context.service.remember({
        ...classifyManualMemory(
          `Project test command ${index} uses bun test with a long explanatory sentence`,
          "alpha",
        ),
        importance: 0.5 + index / 100,
      })
    }
    const result = context.recall.recall({
      projectId: "alpha",
      query: "project test command bun",
      recentTopics: [],
      currentFiles: [],
      now: new Date("2026-08-21T00:00:00.000Z"),
      tokenBudget: 120,
    })
    expect(result.counts.globalCore).toBeLessThanOrEqual(8)
    expect(result.counts.projectCore).toBeLessThanOrEqual(12)
    expect(result.counts.dynamic).toBeLessThanOrEqual(8)
    expect(result.estimatedTokens).toBeLessThanOrEqual(120)
    context.recall.markInjected(result)
    expect(context.memories.get(result.items[0]?.id ?? "")?.recallCount).toBe(1)
  } finally {
    await context.fixture.close()
  }
})

test("oversized task does not suppress higher-priority memories", async () => {
  const context = await setup()
  try {
    context.service.remember(classifyManualMemory("For this project, use bun", "alpha"))
    context.tasks.insert({
      projectId: "alpha",
      goal: "x".repeat(2000),
      status: "active",
      completed: [],
      inProgress: [],
      files: [],
      decisions: [],
      blockers: [],
      nextSteps: [],
      sourceSessionId: "s1",
    })
    const result = context.recall.recall({
      projectId: "alpha",
      query: "bun",
      recentTopics: [],
      currentFiles: [],
      now: new Date(),
      tokenBudget: 100,
    })
    expect(result.items.map((item) => item.content)).toContain("For this project, use bun")
    expect(result.task).toBeUndefined()
  } finally {
    await context.fixture.close()
  }
})
