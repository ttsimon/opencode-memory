import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCanaryPackage, createCanaryManifest } from "../../scripts/canary/build-package"

test("manifest binds one tarball to commit and SHA-256", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-canary-manifest-"))
  try {
    const tarball = join(root, "package.tgz")
    await Bun.write(tarball, "canary-bytes")
    const manifest = await createCanaryManifest({
      repository: root,
      tarball,
      commit: "a".repeat(40),
      packageJson: {
        name: "@ttsimon/opencode-memory",
        version: "0.1.0",
        packageManager: "bun@1.3.14",
        dependencies: { "@opencode-ai/plugin": "1.18.19", "@opencode-ai/sdk": "1.18.19" },
      },
      files: [
        "package/LICENSE",
        "package/README.md",
        "package/dist/index.d.ts",
        "package/dist/index.js",
        "package/package.json",
      ],
      opencodeVersion: "1.18.19",
    })
    expect(manifest.package.name).toBe("@ttsimon/opencode-memory")
    expect(manifest.runtime.opencode).toBe("1.18.19")
    expect(manifest.tarball.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.git.commit).toBe("a".repeat(40))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("build refuses a dirty repository or existing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-canary-build-"))
  const output = join(root, "output")
  await mkdir(output)
  try {
    await expect(
      buildCanaryPackage({
        repository: root,
        output,
        runner: async () => ({ exitCode: 0, stdout: "dirty", stderr: "" }),
      }),
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
