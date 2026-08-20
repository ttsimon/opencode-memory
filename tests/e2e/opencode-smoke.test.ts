import { afterEach, expect, test } from "bun:test"
import { startIsolatedOpenCodeServer } from "../helpers/opencode-server"

let stop: (() => Promise<void>) | undefined

afterEach(async () => {
  await stop?.()
})

test("OpenCode 1.18.18 loads the built plugin and exposes its tool", async () => {
  const server = await startIsolatedOpenCodeServer({
    plugin: new URL("../../dist/index.js", import.meta.url),
  })
  stop = server.stop

  const response = await fetch(
    `${server.baseUrl}/experimental/tool/ids?directory=${encodeURIComponent(server.projectDir)}`,
  )
  expect(response.ok).toBe(true)
  expect(await response.json()).toContain("memory")
  expect(server.stderr()).not.toContain("failed to load plugin")
}, 20_000)
