import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { MemoryService } from "../../src/memory-service"
import type { PluginServices } from "../../src/plugin/hooks"
import { createRuntime } from "../../src/plugin/runtime"
import { SessionState } from "../../src/plugin/session-state"
import { createMemoryTool } from "../../src/plugin/tool"
import { RecallEngine } from "../../src/recall/engine"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
import { TaskRepository } from "../../src/storage/task-repository"
import { createDatabaseFixture } from "../helpers/database"
import { createFakeRuntimeClient } from "../helpers/plugin"

const context: ToolContext = {
  sessionID: "s1",
  messageID: "m1",
  agent: "build",
  directory: "C:/project",
  worktree: "C:/project",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

async function setup() {
  const fixture = await createDatabaseFixture()
  const memories = new MemoryRepository(fixture.database)
  const tasks = new TaskRepository(fixture.database)
  const fake = createFakeRuntimeClient()
  const services: PluginServices = {
    database: fixture.database,
    memory: new MemoryService(fixture.database, memories, new AuditRepository(fixture.database)),
    memories,
    tasks,
    recall: new RecallEngine(memories, tasks),
    state: new SessionState(),
    runtime: createRuntime(fake.client, "C:/project"),
    project: { projectId: "project-1", root: "C:/project", identity: "path:C:/project", kind: "path" },
    directory: "C:/project",
    dispose() {},
  }
  return { fixture, services, tool: createMemoryTool(services) }
}

test("memory tool covers MVP management actions", async () => {
  const fixture = await setup()
  try {
    expect(await fixture.tool.execute({ action: "health" }, context)).toBe("OpenCode Memory is loaded.")
    expect(await fixture.tool.execute({ action: "remember" }, context)).toBe("Memory text is required.")
    const saved = String(await fixture.tool.execute({ action: "remember", text: "Tests use Bun" }, context))
    const id = saved.match(/[0-9a-f-]{36}/i)?.[0]
    expect(id).toBeDefined()
    expect(String(await fixture.tool.execute({ action: "search", query: "Bun" }, context))).toContain("Tests use Bun")
    expect(String(await fixture.tool.execute({ action: "show", id }, context))).toContain("Tests use Bun")
    expect(String(await fixture.tool.execute({ action: "show", id: "missing" }, context))).toBe("Memory not found.")
    expect(String(await fixture.tool.execute({ action: "overview" }, context))).toContain("project-1")
    expect(String(await fixture.tool.execute({ action: "status" }, context))).toContain('"enabled": true')
    expect(await fixture.tool.execute({ action: "disable" }, context)).toBe(
      "OpenCode Memory disabled for this project.",
    )
    expect(String(await fixture.tool.execute({ action: "status" }, context))).toContain('"enabled": false')
    expect(await fixture.tool.execute({ action: "enable" }, context)).toBe("OpenCode Memory enabled for this project.")
    expect(
      String(await fixture.tool.execute({ action: "remember", text: "Always answer me in Chinese" }, context)),
    ).toContain("Saved global preference")
    expect(await fixture.tool.execute({ action: "forget", id }, context)).toBe(`Soft-deleted memory ${id}.`)
    expect(await fixture.tool.execute({ action: "forget", id }, context)).toBe("Memory not found.")
  } finally {
    await fixture.fixture.close()
  }
})

test("degraded memory tool keeps health and reports unavailable storage", async () => {
  const fake = createFakeRuntimeClient()
  const services: PluginServices = {
    state: new SessionState(),
    runtime: createRuntime(fake.client, "C:/project"),
    directory: "C:/project",
    degradedReason: "password=hunter2",
    dispose() {},
  }
  const tool = createMemoryTool(services)
  expect(await tool.execute({ action: "health" }, context)).toBe("OpenCode Memory is loaded.")
  const result = String(await tool.execute({ action: "status" }, context))
  expect(result).not.toContain("hunter2")
  expect(result).toContain("[REDACTED:password]")
})

test("memory tool catches runtime database failures", async () => {
  const fixture = await setup()
  try {
    fixture.fixture.database.raw.close()
    const result = String(await fixture.tool.execute({ action: "search", query: "test" }, context))
    expect(result).toContain("OpenCode Memory is degraded")
    expect(fixture.services.runtime.status().codes).toContain("tool.search")
  } finally {
    await fixture.fixture.close().catch(() => {})
  }
})

test("memory tool redacts sensitive runtime errors", async () => {
  const fake = createFakeRuntimeClient()
  const services = {
    memory: {
      search() {
        throw new Error("password=hunter2")
      },
    },
    database: { raw: {} },
    memories: {},
    project: { projectId: "p1" },
    state: new SessionState(),
    runtime: createRuntime(fake.client, "C:/project"),
    directory: "C:/project",
    dispose() {},
  } as unknown as PluginServices
  const result = String(await createMemoryTool(services).execute({ action: "search", query: "x" }, context))
  expect(result).not.toContain("hunter2")
  expect(result).toContain("[REDACTED:password]")
})
