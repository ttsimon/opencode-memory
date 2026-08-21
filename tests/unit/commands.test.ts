import { expect, test } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"
import { memoryCommandNames, registerCommands, routeMemoryCommand } from "../../src/plugin/commands"

test("registers exactly the MVP commands without overwriting user commands", () => {
  const config: Config = { command: { memory: { template: "user template" } } }
  registerCommands(config, false)
  expect(config.command?.memory?.template).toBe("user template")
  expect(Object.keys(config.command ?? {}).sort()).toEqual([...memoryCommandNames].sort())
})

test("automatic phase adds history and doctor commands", () => {
  const config: Config = {}
  registerCommands(config, true)
  expect(Object.keys(config.command ?? {})).toEqual(expect.arrayContaining(["memory-history", "memory-doctor"]))
})

test("routes command execution to one fixed memory tool action", () => {
  const parts: Part[] = [{ type: "text", text: "original", id: "p1", messageID: "m1", sessionID: "s1" }]
  routeMemoryCommand({ command: "memory-search", arguments: "sqlite" }, { parts })
  const text = parts[0]?.type === "text" ? parts[0].text : ""
  expect(parts[0]?.id).toBe("p1")
  expect(text.includes('action "search"')).toBe(true)
  expect(text.includes("sqlite")).toBe(true)
  expect(text.includes("Return the tool output verbatim")).toBe(true)
  expect(text.includes('query "sqlite"')).toBe(true)
})
