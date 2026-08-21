import { describe, expect, test } from "bun:test"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import plugin, { OpenCodeMemoryPlugin } from "../../src/index"

function fakePluginInput(): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "C:/project",
    worktree: "C:/project",
    experimental_workspace: {
      register() {},
    },
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  } satisfies PluginInput
}

function fakeToolContext(): ToolContext {
  return {
    sessionID: "session",
    messageID: "message",
    agent: "test",
    directory: "C:/project",
    worktree: "C:/project",
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } satisfies ToolContext
}

describe("plugin contract", () => {
  test("exports one OpenCode plugin function", () => {
    expect(plugin).toBe(OpenCodeMemoryPlugin)
    expect(typeof plugin).toBe("function")
  })

  test("registers a deterministic health-only memory tool", async () => {
    const hooks = await plugin(fakePluginInput())
    expect(Object.keys(hooks.tool ?? {})).toEqual(["memory"])
    const result = await hooks.tool?.memory?.execute({ action: "health" }, fakeToolContext())
    expect(result).toBe("OpenCode Memory is loaded.")
  })
})
