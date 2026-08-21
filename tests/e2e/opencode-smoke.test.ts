import { afterEach, expect, test } from "bun:test"
import { startIsolatedOpenCodeServer } from "../helpers/opencode-server"

let stop: (() => Promise<void>) | undefined

afterEach(async () => {
  try {
    await stop?.()
  } finally {
    stop = undefined
  }
})

test("OpenCode 1.18.18 loads the built plugin, tool and MVP commands", async () => {
  const server = await startIsolatedOpenCodeServer({
    plugin: new URL("../../dist/index.js", import.meta.url),
  })
  stop = server.stop

  const toolResponse = await fetch(
    `${server.baseUrl}/experimental/tool/ids?directory=${encodeURIComponent(server.projectDir)}`,
  )
  expect(toolResponse.ok).toBe(true)
  expect(await toolResponse.json()).toContain("memory")

  const commandResponse = await fetch(`${server.baseUrl}/command?directory=${encodeURIComponent(server.projectDir)}`)
  expect(commandResponse.ok).toBe(true)
  const commands = (await commandResponse.json()) as Array<{ name: string }>
  expect(commands.map((command) => command.name)).toEqual(
    expect.arrayContaining([
      "memory",
      "memory-status",
      "memory-search",
      "memory-show",
      "remember",
      "forget",
      "memory-enable",
      "memory-disable",
    ]),
  )
  expect(server.stderr()).not.toContain("failed to load plugin")
}, 20_000)
