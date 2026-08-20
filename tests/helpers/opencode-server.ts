import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

interface StartOpenCodeInput {
  plugin: URL
}

export interface RunningOpenCode {
  baseUrl: string
  projectDir: string
  stderr(): string
  stop(): Promise<void>
}

const expectedVersion = "1.18.18"
const startupTimeoutMs = 15_000

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Failed to reserve an OpenCode server port"))
        return
      }

      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

function redact(value: string, temporaryRoot: string): string {
  let result = value.replaceAll(temporaryRoot, "<temporary-root>")
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /(KEY|PASSWORD|SECRET|TOKEN)/i.test(name)) result = result.replaceAll(secret, `<redacted:${name}>`)
  }
  return result
}

async function seedPluginDependency(directory: string): Promise<void> {
  const pluginPackageDir = join(directory, "node_modules", "@opencode-ai", "plugin")
  const dependencies = { "@opencode-ai/plugin": expectedVersion }
  await mkdir(join(directory, "node_modules", "@opencode-ai"), { recursive: true })
  await symlink(join(import.meta.dir, "../../node_modules/@opencode-ai/plugin"), pluginPackageDir, "junction")
  await Promise.all([
    writeFile(join(directory, "package.json"), `${JSON.stringify({ dependencies }, null, 2)}\n`),
    writeFile(
      join(directory, "package-lock.json"),
      `${JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies } } }, null, 2)}\n`,
    ),
  ])
}

export async function startIsolatedOpenCodeServer(input: StartOpenCodeInput): Promise<RunningOpenCode> {
  const version = Bun.spawnSync(["bunx", "--bun", "opencode", "--version"], {
    cwd: join(import.meta.dir, "../.."),
    stderr: "pipe",
    stdout: "pipe",
  })
  const actualVersion = version.stdout.toString().trim()
  if (version.exitCode !== 0 || actualVersion !== expectedVersion) {
    throw new Error(`Expected OpenCode ${expectedVersion}, received ${actualVersion || "no version"}`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-memory-e2e-"))
  const configDir = join(temporaryRoot, "config")
  const dataDir = join(temporaryRoot, "data")
  const cacheDir = join(temporaryRoot, "cache")
  const stateDir = join(temporaryRoot, "state")
  const projectDir = join(temporaryRoot, "project")
  await Promise.all([configDir, dataDir, cacheDir, stateDir, projectDir].map((directory) => mkdir(directory)))
  await Promise.all([seedPluginDependency(configDir), seedPluginDependency(join(configDir, "opencode"))])
  await writeFile(
    join(configDir, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [input.plugin.href] }, null, 2)}\n`,
  )

  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = Bun.spawn(
    ["bunx", "--bun", "opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs"],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        APPDATA: dataDir,
        LOCALAPPDATA: dataDir,
        OPENCODE_CONFIG_DIR: configDir,
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        XDG_CACHE_HOME: cacheDir,
        XDG_CONFIG_HOME: configDir,
        XDG_DATA_HOME: dataDir,
        XDG_STATE_HOME: stateDir,
      },
      stderr: "pipe",
      stdout: "ignore",
    },
  )
  let stderr = ""
  const stderrReader = (async () => {
    for await (const chunk of child.stderr) stderr += new TextDecoder().decode(chunk)
  })()
  let stopped = false

  const stop = async () => {
    if (stopped) return
    stopped = true
    child.kill()
    await child.exited
    await stderrReader
    await rm(temporaryRoot, { force: true, recursive: true })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), startupTimeoutMs)
  let lastResponse = "no response"
  try {
    while (!controller.signal.aborted) {
      if (child.exitCode !== null) throw new Error(`OpenCode exited with code ${child.exitCode}`)
      try {
        const response = await fetch(`${baseUrl}/path?directory=${encodeURIComponent(projectDir)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1_000)]),
        })
        if (response.ok) return { baseUrl, projectDir, stderr: () => stderr, stop }
        lastResponse = `${response.status} ${await response.text()}`
      } catch (error) {
        if (controller.signal.aborted) break
        lastResponse = error instanceof Error ? error.message : String(error)
      }
      await Bun.sleep(100)
    }
    throw new Error(`OpenCode startup timed out; last /path result: ${lastResponse}`)
  } catch (error) {
    await stop()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${reason}\nOpenCode stderr:\n${redact(stderr, temporaryRoot)}`)
  } finally {
    clearTimeout(timeout)
  }
}
