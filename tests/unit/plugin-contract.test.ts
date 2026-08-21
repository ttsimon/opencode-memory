import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import plugin, { OpenCodeMemoryPlugin } from "../../src/index"

function fakePluginInput(directory: string): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory,
    worktree: directory,
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

  test("registers the structured memory tool and MVP hooks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-memory-plugin-contract-"))
    const previousLocalAppData = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = directory
    try {
      const hooks = await plugin(fakePluginInput(directory))
      expect(Object.keys(hooks.tool ?? {})).toEqual(["memory"])
      const result = await hooks.tool?.memory?.execute({ action: "health" }, fakeToolContext())
      expect(result).toBe("OpenCode Memory is loaded.")
      expect(hooks.config).toBeDefined()
      expect(hooks["chat.message"]).toBeDefined()
      expect(hooks["experimental.chat.system.transform"]).toBeDefined()
      await hooks.dispose?.()
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = previousLocalAppData
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("plugin construction degrades instead of throwing when storage paths are unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-memory-plugin-degraded-"))
    const previousLocalAppData = process.env.LOCALAPPDATA
    const previousHome = process.env.HOME
    const previousXdgDataHome = process.env.XDG_DATA_HOME
    delete process.env.LOCALAPPDATA
    delete process.env.HOME
    delete process.env.XDG_DATA_HOME
    try {
      const hooks = await plugin(fakePluginInput(directory))
      const result = await hooks.tool?.memory?.execute({ action: "status" }, fakeToolContext())
      expect(String(result)).toContain("OpenCode Memory is degraded")
    } finally {
      if (previousLocalAppData !== undefined) process.env.LOCALAPPDATA = previousLocalAppData
      if (previousHome !== undefined) process.env.HOME = previousHome
      if (previousXdgDataHome !== undefined) process.env.XDG_DATA_HOME = previousXdgDataHome
      await rm(directory, { recursive: true, force: true })
    }
  })
})
