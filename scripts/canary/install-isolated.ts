import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { startIsolatedOpenCodeServer } from "../../tests/helpers/opencode-server"
import type { CanaryManifest } from "./types"

const expectedCommands = [
  "memory",
  "memory-status",
  "memory-search",
  "memory-show",
  "remember",
  "forget",
  "memory-enable",
  "memory-disable",
  "memory-history",
  "memory-doctor",
]

export async function installIsolatedCanary(manifestPath: string, onStage: (stage: string) => void = () => {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CanaryManifest
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-tarball-canary-"))
  const install = join(root, "install")
  let server: Awaited<ReturnType<typeof startIsolatedOpenCodeServer>> | undefined
  try {
    onStage("install-tarball")
    await mkdir(install)
    await Bun.write(join(install, "package.json"), `${JSON.stringify({ dependencies: {} }, null, 2)}\n`)
    await run(["bun", "add", manifest.tarball.path], install)
    const packageRoot = join(install, "node_modules", "@ttsimon", "opencode-memory")
    const installed = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version: string }
    onStage("start-opencode")
    server = await startIsolatedOpenCodeServer({ plugin: pathToFileURL(join(packageRoot, "dist", "index.js")) })
    const toolIds = (await fetch(
      `${server.baseUrl}/experimental/tool/ids?directory=${encodeURIComponent(server.projectDir)}`,
    ).then((response) => response.json())) as string[]
    const commands = (await fetch(`${server.baseUrl}/command?directory=${encodeURIComponent(server.projectDir)}`).then(
      (response) => response.json(),
    )) as Array<{ name: string }>
    return {
      root,
      packageVersion: installed.version,
      toolIds,
      commandNames: commands.map((command) => command.name),
      dataFiles: await listFiles(server.dataDir),
      expectedCommands,
      async cleanup() {
        if (server) await server.stop()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (server) await server.stop().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`${command.join(" ")} failed: ${stderr}`)
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = []
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name)
      if (entry.isDirectory()) await walk(target)
      else output.push(target.slice(root.length + 1).replaceAll("\\", "/"))
    }
  }
  await walk(root)
  return output.sort()
}

if (import.meta.main) {
  const manifest = process.argv[2]
  if (!manifest) throw new Error("Usage: bun run scripts/canary/install-isolated.ts <manifest>")
  const canary = await installIsolatedCanary(manifest)
  console.log(
    JSON.stringify(
      {
        packageVersion: canary.packageVersion,
        toolIds: canary.toolIds,
        commandNames: canary.commandNames,
        dataFiles: canary.dataFiles,
      },
      null,
      2,
    ),
  )
  await canary.cleanup()
}
