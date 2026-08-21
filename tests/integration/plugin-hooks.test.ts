import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"
import { classifyManualMemory } from "../../src/domain/classification"
import { MemoryService } from "../../src/memory-service"
import { createDegradedServices, createHooks, createServices, type PluginServices } from "../../src/plugin/hooks"
import { createRuntime } from "../../src/plugin/runtime"
import { SessionState } from "../../src/plugin/session-state"
import { RecallEngine } from "../../src/recall/engine"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
import { TaskRepository } from "../../src/storage/task-repository"
import { createDatabaseFixture } from "../helpers/database"
import { createFakeRuntimeClient } from "../helpers/plugin"

async function setup(): Promise<{
  services: PluginServices
  hooks: Hooks
  toasts: Array<Record<string, unknown>>
  close(): Promise<void>
}> {
  const fixture = await createDatabaseFixture()
  const memories = new MemoryRepository(fixture.database)
  const audit = new AuditRepository(fixture.database)
  const memory = new MemoryService(fixture.database, memories, audit)
  const tasks = new TaskRepository(fixture.database)
  const state = new SessionState()
  const fake = createFakeRuntimeClient()
  const services: PluginServices = {
    database: fixture.database,
    memory,
    memories,
    tasks,
    recall: new RecallEngine(memories, tasks),
    state,
    runtime: createRuntime(fake.client, "C:/project"),
    project: { projectId: "project-1", root: "C:/project", identity: "path:C:/project", kind: "path" },
    directory: "C:/project",
    dispose() {},
  }
  return { services, hooks: createHooks(services), toasts: fake.toasts, close: fixture.close }
}

function userParts(text: string): Part[] {
  return [{ id: "p1", messageID: "m1", sessionID: "s1", type: "text", text }]
}

test("prepares recall on chat.message and injects it into the matching session", async () => {
  const context = await setup()
  try {
    const memory = context.services.memory
    if (!memory) throw new Error("memory service unavailable")
    memory.remember(classifyManualMemory("For this project, use bun for all scripts", "project-1"))
    await context.hooks["chat.message"]?.(
      { sessionID: "s1", messageID: "m1" },
      {
        message: {
          id: "m1",
          sessionID: "s1",
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: userParts("How do we run scripts?"),
      },
    )
    const output = { system: [] as string[] }
    await context.hooks["experimental.chat.system.transform"]?.({ sessionID: "s1", model: {} as never }, output)
    expect(output.system.join("\n")).toContain("<opencode-memory>")
    expect(output.system.join("\n")).toContain("use bun for all scripts")
    expect(context.services.state.consumeRecall("s1")).toBeUndefined()
  } finally {
    await context.close()
  }
})

test("chat.message automatically saves explicit high-confidence preferences once", async () => {
  const context = await setup()
  try {
    const output = {
      message: {
        id: "m1",
        sessionID: "s1",
        role: "user" as const,
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      },
      parts: userParts("Always answer me in Chinese"),
    }
    await context.hooks["chat.message"]?.({ sessionID: "s1", messageID: "m1" }, output)
    await context.hooks["chat.message"]?.({ sessionID: "s1", messageID: "m1" }, output)
    expect(context.services.memories?.count()).toBe(1)
    expect(context.services.memories?.listByStatus("active")[0]).toMatchObject({
      scope: "global",
      kind: "preference",
    })
    expect(context.toasts.filter((toast) => toast.variant === "success")).toHaveLength(1)
  } finally {
    await context.close()
  }
})

test("disabled project skips recall but remains manually accessible", async () => {
  const context = await setup()
  try {
    const database = context.services.database
    if (!database) throw new Error("database unavailable")
    database.raw
      .query("INSERT INTO settings (scope_key, enabled, updated_at) VALUES (?, 0, ?)")
      .run("project:project-1", new Date().toISOString())
    await context.hooks["chat.message"]?.(
      { sessionID: "s1", messageID: "m1" },
      {
        message: {
          id: "m1",
          sessionID: "s1",
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: userParts("test"),
      },
    )
    expect(context.services.state.consumeRecall("s1")).toBeUndefined()
    const compaction = { context: [] as string[] }
    await context.hooks["experimental.session.compacting"]?.({ sessionID: "s1" }, compaction)
    expect(compaction.context).toEqual([])
    await context.hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
    expect(context.services.tasks?.list("project-1")).toEqual([])
  } finally {
    await context.close()
  }
})

test("file events populate later session state and session deletion cleans it", async () => {
  const context = await setup()
  try {
    await context.hooks.event?.({ event: { type: "file.edited", properties: { file: "src/new.ts" } } as never })
    expect(context.services.state.get("later").currentFiles).toEqual(["src/new.ts"])
    context.services.state.recordWrite("later", { outcome: "created", id: "m1" })
    await context.hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "later" } } } as never })
    expect(context.services.state.get("later").currentFiles).toEqual(["src/new.ts"])
    expect(context.services.state.get("later").lastWrites).toEqual([])
  } finally {
    await context.close()
  }
})

test("healthy hooks accept unrelated events and dispose their database", async () => {
  const context = await setup()
  await context.hooks.event?.({ event: { type: "file.edited", properties: { file: "src/index.ts" } } as never })
  const system = { system: [] as string[] }
  await context.hooks["experimental.chat.system.transform"]?.({ model: {} as never }, system)
  expect(system.system).toEqual([])
  const parts = userParts("original")
  await context.hooks["command.execute.before"]?.(
    { command: "memory-search", sessionID: "s1", arguments: "sqlite" },
    { parts },
  )
  expect(parts[0]?.type === "text" ? parts[0].text : "").toContain('action "search"')
  await expect(context.hooks.dispose?.()).resolves.toBeUndefined()
  await context.close().catch(() => {})
})

test("dispose closes healthy services and degraded hooks remain callable", async () => {
  const context = await setup()
  let disposed = false
  const degraded: PluginServices = {
    state: new SessionState(),
    runtime: context.services.runtime,
    directory: "C:/project",
    degradedReason: "locked",
    dispose() {
      disposed = true
    },
  }
  const hooks = createHooks(degraded)
  const config = {}
  await hooks.config?.(config)
  await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } as never })
  await hooks.dispose?.()
  expect(disposed).toBe(true)
  expect(config).toHaveProperty("command.memory")
  await context.close()
})

test("service construction closes storage when project resolution fails", async () => {
  const fake = createFakeRuntimeClient()
  const directory = `${process.cwd()}/missing-project-directory`
  await expect(
    createServices(
      {
        client: {} as PluginInput["client"],
        project: {} as PluginInput["project"],
        directory,
        worktree: directory,
        experimental_workspace: { register() {} },
        serverUrl: new URL("http://localhost"),
        $: {} as PluginInput["$"],
      },
      undefined,
      createRuntime(fake.client, directory),
    ),
  ).rejects.toThrow()
})

test("service message adapter calls the OpenCode SDK with the current directory and limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-memory-service-messages-"))
  const dataRoot = await mkdtemp(join(tmpdir(), "opencode-memory-service-data-"))
  const previousLocalAppData = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = dataRoot
  let received: unknown
  try {
    const services = await createServices(
      {
        client: {
          session: {
            async messages(input: unknown) {
              received = input
              return { data: [], error: undefined }
            },
          },
        } as unknown as PluginInput["client"],
        project: {} as PluginInput["project"],
        directory,
        worktree: directory,
        experimental_workspace: { register() {} },
        serverUrl: new URL("http://localhost"),
        $: {} as PluginInput["$"],
      },
      undefined,
      createRuntime(createFakeRuntimeClient().client, directory),
    )
    expect(await services.messages?.("s1")).toEqual([])
    expect(received).toEqual({ path: { id: "s1" }, query: { directory, limit: 100 } })
    services.dispose()
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousLocalAppData
    await rm(directory, { recursive: true, force: true })
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test("createDegradedServices records Error and non-Error reasons", () => {
  const fake = createFakeRuntimeClient()
  const runtime = createRuntime(fake.client, "C:/project")
  expect(createDegradedServices(runtime, "C:/project", new Error("locked")).degradedReason).toBe("locked")
  expect(createDegradedServices(runtime, "C:/project", "offline").degradedReason).toBe("offline")
})
