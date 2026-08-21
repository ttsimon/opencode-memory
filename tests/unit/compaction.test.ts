import { expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import type { PluginServices } from "../../src/plugin/hooks"
import { createHooks } from "../../src/plugin/hooks"
import { createRuntime } from "../../src/plugin/runtime"
import { SessionState } from "../../src/plugin/session-state"
import { createFakeRuntimeClient } from "../helpers/plugin"

function hooks(task?: PluginServices["taskService"]): Hooks {
  const fake = createFakeRuntimeClient()
  return createHooks({
    ...(task ? { taskService: task } : {}),
    state: new SessionState(),
    runtime: createRuntime(fake.client, "C:/project"),
    project: { projectId: "project-1", root: "C:/project", identity: "path:C:/project", kind: "path" },
    directory: "C:/project",
    dispose() {},
  })
}

test("appends task and secret-safety requirements without replacing the prompt", async () => {
  const task = {
    getActive() {
      return {
        id: "t1",
        projectId: "project-1",
        goal: "Implement recall",
        status: "active" as const,
        completed: ["Add schema"],
        inProgress: ["Add ranking"],
        files: ["src/recall/engine.ts"],
        decisions: ["Use FTS"],
        blockers: [],
        nextSteps: ["Run tests"],
        updatedAt: "2026-08-21",
        sourceSessionId: "s1",
      }
    },
    replace() {
      throw new Error("not used")
    },
    archive() {
      throw new Error("not used")
    },
  } satisfies NonNullable<PluginServices["taskService"]>
  const output: { context: string[]; prompt?: string } = { context: [] }
  await hooks(task)["experimental.session.compacting"]?.({ sessionID: "s1" }, output)
  expect(output.prompt).toBeUndefined()
  expect(output.context).toHaveLength(1)
  expect(output.context[0]).toContain("current task goal and status")
  expect(output.context[0]).toContain("Goal: Implement recall")
  expect(output.context[0]).toContain("Next steps: Run tests")
  expect(output.context[0]).toContain("Do not copy sensitive information")
})

test("adds general preservation requirements without an active task", async () => {
  const output: { context: string[]; prompt?: string } = { context: [] }
  await hooks()["experimental.session.compacting"]?.({ sessionID: "s1" }, output)
  expect(output.context[0]).toContain("key decisions and their reasons")
  expect(output.context[0]).not.toContain("password=hunter2")
})
