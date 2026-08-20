import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

interface StartOpenCodeInput {
  plugin: URL
}

interface ProcessHandle {
  exited: Promise<number>
  exitCode: number | null
  kill(signal?: number | NodeJS.Signals): void
  pid: number
}

interface PortRetryInput<T> {
  deadline: number
  maxAttempts?: number
  start(): Promise<T>
}

interface TerminateOptions {
  platform?: NodeJS.Platform
  runTaskkill?: (args: string[]) => Promise<void>
  timeoutMs?: number
}

export interface RunningOpenCode {
  baseUrl: string
  projectDir: string
  stderr(): string
  stop(): Promise<void>
}

const expectedVersion = "1.18.18"
const startupTimeoutMs = 15_000
const stopTimeoutMs = 3_000
const terminateStepTimeoutMs = 1_000
const portAttempts = 5

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  const completed = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    }),
  ])
  if (timer) clearTimeout(timer)
  return completed
}

async function defaultTaskkill(args: string[]): Promise<void> {
  const taskkill = Bun.spawn(["taskkill", ...args], { stderr: "ignore", stdout: "ignore" })
  await taskkill.exited
}

export async function terminateProcess(child: ProcessHandle, options: TerminateOptions = {}): Promise<void> {
  if (child.exitCode !== null) return
  const timeoutMs = options.timeoutMs ?? terminateStepTimeoutMs
  const platform = options.platform ?? process.platform

  if (platform === "win32") {
    try {
      child.kill()
      if (await settleWithin(child.exited, timeoutMs)) return
    } catch {
      // taskkill below is the process-tree fallback when Bun cannot terminate the child.
    }
    await settleWithin((options.runTaskkill ?? defaultTaskkill)(["/PID", String(child.pid), "/T", "/F"]), timeoutMs)
    await settleWithin(child.exited, timeoutMs)
    return
  }

  child.kill("SIGTERM")
  if (await settleWithin(child.exited, timeoutMs)) return
  child.kill("SIGKILL")
  await settleWithin(child.exited, timeoutMs)
}

export async function runWithPortRetries<T>(input: PortRetryInput<T>): Promise<T> {
  const maxAttempts = input.maxAttempts ?? portAttempts
  let attempts = 0
  let lastError = "EADDRINUSE"

  while (attempts < maxAttempts && Date.now() < input.deadline) {
    attempts += 1
    try {
      return await input.start()
    } catch (error) {
      lastError = errorText(error)
      if (!/EADDRINUSE|address already in use/i.test(lastError)) throw error
      const remaining = input.deadline - Date.now()
      if (attempts < maxAttempts && remaining > 0) await Bun.sleep(Math.min(100, remaining))
    }
  }

  throw new Error(`Could not start OpenCode on an available port after ${attempts} attempts: ${lastError}`)
}

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

export function redactOutput(
  value: string,
  temporaryRoot: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  let result = value.replaceAll(temporaryRoot, "<temporary-root>")
  const secrets = Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[1]) && /(KEY|PASSWORD|SECRET|TOKEN)/i.test(entry[0]))
    .sort((left, right) => right[1].length - left[1].length)
  for (const [name, secret] of secrets) result = result.replaceAll(secret, `<redacted:${name}>`)
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
  const deadline = Date.now() + startupTimeoutMs
  let removeTemporaryRoot = true
  let diagnosticStderr = ""

  try {
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

    const started = await runWithPortRetries({
      deadline,
      async start() {
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
        let rawStderr = ""
        const decoder = new TextDecoder()
        const stderrReader = (async () => {
          for await (const chunk of child.stderr) rawStderr += decoder.decode(chunk, { stream: true })
          rawStderr += decoder.decode()
        })()
        let lastResponse = "no response"

        try {
          while (Date.now() < deadline) {
            if (child.exitCode !== null) {
              await settleWithin(stderrReader, 100)
              throw new Error(`OpenCode exited with code ${child.exitCode}: ${redactOutput(rawStderr, temporaryRoot)}`)
            }
            try {
              const remaining = deadline - Date.now()
              const response = await fetch(`${baseUrl}/path?directory=${encodeURIComponent(projectDir)}`, {
                signal: AbortSignal.timeout(Math.max(1, Math.min(1_000, remaining))),
              })
              if (response.ok) return { baseUrl, child, rawStderr: () => rawStderr, stderrReader }
              lastResponse = redactOutput(`${response.status} ${await response.text()}`, temporaryRoot)
            } catch (error) {
              lastResponse = redactOutput(errorText(error), temporaryRoot)
            }
            const remaining = deadline - Date.now()
            if (remaining > 0) await Bun.sleep(Math.min(100, remaining))
          }
          throw new Error(`OpenCode startup timed out; last /path result: ${lastResponse}`)
        } catch (error) {
          await terminateProcess(child)
          await settleWithin(stderrReader, terminateStepTimeoutMs)
          diagnosticStderr += redactOutput(rawStderr, temporaryRoot)
          throw error
        }
      },
    })

    let stopped = false
    const stop = async () => {
      if (stopped) return
      stopped = true
      const stopDeadline = Date.now() + stopTimeoutMs
      try {
        await terminateProcess(started.child, {
          timeoutMs: Math.min(terminateStepTimeoutMs, Math.max(1, stopDeadline - Date.now())),
        })
        await settleWithin(started.stderrReader, Math.max(1, stopDeadline - Date.now()))
      } finally {
        const cleanup = rm(temporaryRoot, { force: true, recursive: true })
        if (!(await settleWithin(cleanup, Math.max(1, stopDeadline - Date.now())))) void cleanup.catch(() => {})
      }
    }

    removeTemporaryRoot = false
    return {
      baseUrl: started.baseUrl,
      projectDir,
      stderr: () => redactOutput(started.rawStderr(), temporaryRoot),
      stop,
    }
  } catch (error) {
    const reason = redactOutput(errorText(error), temporaryRoot)
    throw new Error(`${reason}\nOpenCode stderr:\n${diagnosticStderr}`)
  } finally {
    if (removeTemporaryRoot) await rm(temporaryRoot, { force: true, recursive: true })
  }
}
