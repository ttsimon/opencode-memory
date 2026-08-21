import { expect, test } from "bun:test"
import { patchGlobalConfig, validateNoLiteralProviderSecrets } from "../../scripts/canary/install-global"

test("adds tarball dependency and plugin without changing unrelated config", () => {
  const config = {
    $schema: "https://opencode.ai/config.json",
    plugin: ["superpowers@git+https://github.com/obra/superpowers.git"],
    mcp: { figma: { type: "remote", url: "http://localhost", enabled: true } },
  }
  const packageJson = { dependencies: { "@opencode-ai/plugin": "1.18.4" } }
  const result = patchGlobalConfig(JSON.stringify(config, null, 2), JSON.stringify(packageJson, null, 2), {
    package: { name: "@ttsimon/opencode-memory", version: "0.1.0" },
    tarball: { path: "C:/canary/package.tgz", sha256: "a".repeat(64), files: [] },
  })
  expect(result.config.plugin).toEqual([
    "superpowers@git+https://github.com/obra/superpowers.git",
    expect.stringContaining("node_modules/@ttsimon/opencode-memory/dist/index.js"),
  ])
  expect(result.packageJson.dependencies["@ttsimon/opencode-memory"]).toBe("file:C:/canary/package.tgz")
  expect((result.config as Record<string, unknown>).mcp).toEqual(config.mcp)
})

test("rejects literal provider secrets but accepts environment references", () => {
  expect(() =>
    validateNoLiteralProviderSecrets({ provider: { demo: { options: { apiKey: "literal-secret" } } } }),
  ).toThrow("rotate and migrate provider secrets")
  expect(() =>
    validateNoLiteralProviderSecrets({ provider: { demo: { options: { apiKey: "{env:DEMO_API_KEY}" } } } }),
  ).not.toThrow()
})
