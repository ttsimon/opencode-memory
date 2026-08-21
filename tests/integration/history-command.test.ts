import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { MemoryDoctor } from "../../src/diagnostics/doctor"
import { MemoryService } from "../../src/memory-service"
import type { PluginServices } from "../../src/plugin/hooks"
import { createRuntime } from "../../src/plugin/runtime"
import { SessionState } from "../../src/plugin/session-state"
import { createMemoryTool } from "../../src/plugin/tool"
import { AuditRepository } from "../../src/storage/audit-repository"
import { MemoryRepository } from "../../src/storage/memory-repository"
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

test("history renders status transitions without rejected source text", async () => {
  const fixture = await createDatabaseFixture()
  const memories = new MemoryRepository(fixture.database)
  const audit = new AuditRepository(fixture.database)
  const memory = new MemoryService(fixture.database, memories, audit)
  const fake = createFakeRuntimeClient()
  const services: PluginServices = {
    database: fixture.database,
    memory,
    memories,
    state: new SessionState(),
    runtime: createRuntime(fake.client, "C:/project"),
    project: { projectId: "p1", root: "C:/project", identity: "path:C:/project", kind: "path" },
    directory: "C:/project",
    doctor: new MemoryDoctor(fixture.database, fixture.paths),
    dispose() {},
  }
  try {
    const base = {
      scope: "project" as const,
      projectId: "p1",
      kind: "fact" as const,
      confidence: 1,
      importance: 0.9,
      conflictKey: "runner",
    }
    const old = memory.remember({ ...base, content: "Tests use Jest", sourceSessionId: "s1" })
    memory.remember({ ...base, content: "Tests use Bun", sourceSessionId: "s1" })
    memory.remember({ ...base, conflictKey: "secret", content: "password=hunter2" })
    if (old.outcome === "rejected") throw new Error("unexpected rejection")
    const output = String(await createMemoryTool(services).execute({ action: "history", id: old.memory.id }, context))
    expect(output).toContain("active -> superseded")
    expect(output).toContain("session: s1")
    expect(output).not.toContain("hunter2")
    expect(String(await createMemoryTool(services).execute({ action: "doctor" }, context))).toContain('"checks"')
  } finally {
    await fixture.close()
  }
})
