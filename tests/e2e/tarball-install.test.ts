import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installIsolatedCanary } from "../../scripts/canary/install-isolated"

test("installs a packed tarball and loads tool plus ten commands", async () => {
  const output = await mkdtemp(join(tmpdir(), "opencode-memory-packed-test-"))
  try {
    const pack = Bun.spawn(["bun", "pm", "pack", "--ignore-scripts", "--destination", output], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(await pack.exited).toBe(0)
    const tarball = join(output, (await Array.fromAsync(new Bun.Glob("*.tgz").scan(output)))[0] ?? "missing.tgz")
    const bytes = await Bun.file(tarball).arrayBuffer()
    const manifestPath = join(output, "canary-manifest.json")
    await Bun.write(
      manifestPath,
      JSON.stringify({
        package: { name: "@ttsimon/opencode-memory", version: "0.1.0" },
        git: { commit: "test" },
        runtime: { bun: "1.3.14", opencode: "1.18.19", plugin: "1.18.19", sdk: "1.18.19" },
        tarball: { path: tarball, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), files: [] },
        builtAt: new Date().toISOString(),
      }),
    )
    const canary = await installIsolatedCanary(manifestPath)
    try {
      expect(canary.packageVersion).toBe("0.1.0")
      expect(canary.toolIds).toContain("memory")
      expect(canary.commandNames).toEqual(expect.arrayContaining(canary.expectedCommands))
    } finally {
      await canary.cleanup()
    }
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}, 90_000)
