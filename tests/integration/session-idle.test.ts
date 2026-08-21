import { expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk"
import { MemoryService } from "../../src/memory-service"
import { createHooks, type PluginServices } from "../../src/plugin/hooks"
import { createRuntime } from "../../src/plugin/runtime"
import { SessionState } from "../../src/plugin/session-state"
import { RecallEngine } from "../../src/recall/engine"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
import { TaskRepository } from "../../src/storage/task-repository"
import { TaskService } from "../../src/task-service"
import { createDatabaseFixture } from "../helpers/database"
import { createFakeRuntimeClient } from "../helpers/plugin"

function textPart(messageID: string, text: string): Part {
  return { id: `${messageID}-part`, messageID, sessionID: "s1", type: "text", text }
}

async function setup(messages: NonNullable<PluginServices["messages"]>) {
  const fixture = await createDatabaseFixture()
  const memories = new MemoryRepository(fixture.database)
  const tasks = new TaskRepository(fixture.database)
  const audit = new AuditRepository(fixture.database)
  const fake = createFakeRuntimeClient()
  const services: PluginServices = {
    database: fixture.database,
    memory: new MemoryService(fixture.database, memories, audit),
    memories,
    tasks,
    taskService: new TaskService(fixture.database, tasks, audit),
    recall: new RecallEngine(memories, tasks),
    state: new SessionState(),
    runtime: createRuntime(fake.client, "C:/project"),
    project: { projectId: "project-1", root: "C:/project", identity: "path:C:/project", kind: "path" },
    directory: "C:/project",
    messages,
    dispose() {},
  }
  return { fixture, services, hooks: createHooks(services) }
}

test("session.idle fetches messages and updates the active task", async () => {
  let calls = 0
  const context = await setup(async (sessionId) => {
    calls += 1
    expect(sessionId).toBe("s1")
    return [
      {
        info: {
          id: "m1",
          sessionID: "s1",
          role: "user" as const,
          time: { created: 1 },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: [textPart("m1", "Implement memory search")],
      },
      {
        info: {
          id: "m2",
          sessionID: "s1",
          role: "assistant" as const,
          parentID: "m1",
          time: { created: 2, completed: 3 },
          modelID: "test",
          providerID: "test",
          mode: "build",
          path: { cwd: "C:/project", root: "C:/project" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [textPart("m2", "Added the query parser. Next step: add FTS ranking tests.")],
      },
    ]
  })
  try {
    await context.hooks.event?.({
      event: {
        type: "todo.updated",
        properties: {
          sessionID: "s1",
          todos: [
            { id: "1", content: "Add query parser", status: "completed", priority: "high" },
            { id: "2", content: "Add FTS ranking tests", status: "pending", priority: "high" },
          ],
        },
      } as never,
    })
    context.services.state.addCurrentFile("s1", "src/recall/engine.ts")
    await context.hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
    expect(calls).toBe(1)
    expect(context.services.taskService?.getActive("project-1")).toMatchObject({
      goal: "Implement memory search",
      completed: ["Add query parser"],
      inProgress: ["Add FTS ranking tests"],
      files: ["src/recall/engine.ts"],
      nextSteps: expect.arrayContaining(["Add FTS ranking tests"]),
    })
    await context.hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
    expect(calls).toBe(2)
    expect(context.services.tasks?.list("project-1")).toHaveLength(1)
  } finally {
    await context.fixture.close()
  }
})

test("failed finalization stores only sanitized retry metadata and stops after three attempts", async () => {
  let calls = 0
  const context = await setup(async () => {
    calls += 1
    throw new Error("password=hunter2")
  })
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await context.hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
    }
    const rows = context.fixture.database.raw
      .query<{ metadata_json: string; attempts: number }, []>("SELECT metadata_json, attempts FROM pending_events")
      .all()
    expect(rows).toEqual([{ metadata_json: expect.any(String), attempts: 3 }])
    expect(rows[0]?.metadata_json).not.toContain("hunter2")
    expect(context.fixture.database.raw.serialize().toString("utf8")).not.toContain("hunter2")
    expect(calls).toBe(3)
  } finally {
    await context.fixture.close()
  }
})

test("idle never persists sensitive task fields", async () => {
  const context = await setup(async () => [
    {
      info: {
        id: "m1",
        sessionID: "s1",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "x", modelID: "x" },
      },
      parts: [textPart("m1", "password=hunter2 fix login")],
    },
  ])
  try {
    context.services.state.setTodos("s1", [{ id: "1", content: "TOKEN=secret", status: "pending", priority: "high" }])
    context.services.state.addCurrentFile("s1", "password=hunter2.txt")
    await context.hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
    expect(context.fixture.database.raw.serialize().toString("utf8")).not.toContain("hunter2")
    expect(context.fixture.database.raw.serialize().toString("utf8")).not.toContain("TOKEN=secret")
  } finally {
    await context.fixture.close()
  }
})

test("completed todos archive the active task instead of creating another active snapshot", async () => {
  const context = await setup(async () => [])
  try {
    context.services.taskService?.replace({
      projectId: "project-1",
      goal: "Finish",
      status: "active",
      completed: [],
      inProgress: [],
      files: [],
      decisions: [],
      blockers: [],
      nextSteps: [],
      sourceSessionId: "s1",
    })
    context.services.state.setTodos("s1", [{ id: "1", content: "Finish", status: "completed", priority: "high" }])
    await context.hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
    expect(context.services.taskService?.getActive("project-1")).toBeUndefined()
  } finally {
    await context.fixture.close()
  }
})
