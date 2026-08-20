import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { delimiter, join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../..")
const testRoot = join(repositoryRoot, ".tmp")
let fixtureDirectory = ""

async function runScript(script: string, args: string[] = [], env: Record<string, string | undefined> = process.env) {
  const child = Bun.spawn([process.execPath, join(repositoryRoot, "scripts", script), ...args], {
    cwd: fixtureDirectory,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return child.exited
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  await mkdir(testRoot, { recursive: true })
  fixtureDirectory = await mkdtemp(join(testRoot, "build-scripts-"))
})

afterEach(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true })
})

describe("build scripts", () => {
  test("removes the temporary package directory when packing fails", async () => {
    await writeFile(join(fixtureDirectory, "package.json"), "not valid json\n")

    expect(await runScript("check-package.ts")).not.toBe(0)
    expect(await pathExists(join(fixtureDirectory, ".tmp/package"))).toBe(false)
  })

  test("removes the temporary package directory when listing the package fails", async () => {
    const binDirectory = join(fixtureDirectory, "bin")
    await mkdir(join(fixtureDirectory, "dist"), { recursive: true })
    await mkdir(binDirectory)
    await writeFile(
      join(fixtureDirectory, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", files: ["dist"] }),
    )
    await writeFile(join(fixtureDirectory, "dist/index.js"), "export {}\n")
    const tarPath = join(binDirectory, process.platform === "win32" ? "tar.cmd" : "tar")
    await writeFile(tarPath, process.platform === "win32" ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n")
    if (process.platform !== "win32") await chmod(tarPath, 0o755)

    const path = `${binDirectory}${delimiter}${process.env.PATH ?? ""}`
    expect(await runScript("check-package.ts", [], { ...process.env, PATH: path })).not.toBe(0)
    expect(await pathExists(join(fixtureDirectory, ".tmp/package"))).toBe(false)
  })

  test.each([
    ["trailing whitespace", "line  \n"],
    ["CRLF", "line\r\n"],
    ["missing final newline", "line"],
  ])("checks explicit Markdown in an excluded directory for %s", async (_name, content) => {
    await mkdir(join(fixtureDirectory, "dist"))
    await writeFile(join(fixtureDirectory, "dist/bad.md"), content)

    expect(await runScript("check-markdown.ts", ["dist/bad.md"])).not.toBe(0)
  })

  test("fails for an explicit non-Markdown file", async () => {
    await writeFile(join(fixtureDirectory, "notes.txt"), "valid\n")

    expect(await runScript("check-markdown.ts", ["notes.txt"])).not.toBe(0)
  })

  test("fails for an explicit missing Markdown file", async () => {
    expect(await runScript("check-markdown.ts", ["missing.md"])).not.toBe(0)
  })
})
