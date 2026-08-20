import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("repository toolchain", () => {
  test("pins the host-compatible Bun and OpenCode versions", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"))
    const mise = await readFile(".mise.toml", "utf8")

    expect(packageJson.packageManager).toBe("bun@1.3.14")
    expect(packageJson.dependencies["@opencode-ai/plugin"]).toBe("1.18.18")
    expect(packageJson.dependencies["@opencode-ai/sdk"]).toBe("1.18.18")
    expect(packageJson.devDependencies["opencode-ai"]).toBe("1.18.18")
    expect(mise).toContain('bun = "1.3.14"')
  })

  test("uses Bun-native coverage thresholds", async () => {
    const bunfig = await readFile("bunfig.toml", "utf8")
    expect(bunfig).toContain("lines = 0.9")
    expect(bunfig).toContain("functions = 0.9")
    expect(bunfig).toContain('"tests/helpers/**"')
  })
})
