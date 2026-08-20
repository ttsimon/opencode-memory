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

interface VersionProcessHandle extends ProcessHandle {
  stderr: ReadableStream<Uint8Array>
  stdout: ReadableStream<Uint8Array>
}

interface VersionCheckInput {
  platform?: NodeJS.Platform
  spawn?: () => VersionProcessHandle
  timeoutMs?: number
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
const versionCheckTimeoutMs = 5_000
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

async function requireWithin<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), Math.max(1, timeoutMs))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function defaultTaskkill(args: string[]): Promise<void> {
  const taskkill = Bun.spawn(["taskkill", ...args], { stderr: "pipe", stdout: "ignore" })
  const [exitCode, stderr] = await Promise.all([taskkill.exited, new Response(taskkill.stderr).text()])
  if (exitCode !== 0) throw new Error(stderr.trim() || `taskkill exited with code ${exitCode}`)
}

export async function terminateProcess(child: ProcessHandle, options: TerminateOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? terminateStepTimeoutMs
  const platform = options.platform ?? process.platform

  if (platform === "win32") {
    if (child.exitCode === null) {
      try {
        child.kill()
        await settleWithin(child.exited, timeoutMs)
      } catch {
        // taskkill below is authoritative for the full process tree.
      }
    }
    try {
      await requireWithin(
        (options.runTaskkill ?? defaultTaskkill)(["/PID", String(child.pid), "/T", "/F"]),
        timeoutMs,
        `taskkill timed out after ${timeoutMs}ms`,
      )
    } catch (error) {
      if (!/not found|no running instance|not exist/i.test(errorText(error))) {
        throw new Error(`taskkill failed: ${errorText(error)}`)
      }
    }
    if (await settleWithin(child.exited, timeoutMs)) return
    throw new Error(`OpenCode process ${child.pid} did not exit after taskkill`)
  }

  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  if (await settleWithin(child.exited, timeoutMs)) return
  child.kill("SIGKILL")
  if (await settleWithin(child.exited, timeoutMs)) return
  throw new Error(`OpenCode process ${child.pid} did not exit after SIGKILL`)
}

export async function assertOpenCodeVersion(input: VersionCheckInput = {}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? versionCheckTimeoutMs
  const child = (
    input.spawn ??
    ((() =>
      Bun.spawn(["bunx", "--bun", "opencode", "--version"], {
        cwd: join(import.meta.dir, "../.."),
        stderr: "pipe",
        stdout: "pipe",
      })) as () => VersionProcessHandle)
  )()
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const completed = Promise.all([child.exited, stdout, stderr])

  if (!(await settleWithin(completed, timeoutMs))) {
    let cleanupFailure = ""
    try {
      await terminateProcess(child, {
        ...(input.platform ? { platform: input.platform } : {}),
        timeoutMs,
      })
    } catch (error) {
      cleanupFailure = `; cleanup failed: ${errorText(error)}`
    }
    throw new Error(`OpenCode version check timed out after ${timeoutMs}ms${cleanupFailure}`)
  }

  const [exitCode, actualVersion, diagnosticStderr] = await completed
  if (exitCode !== 0 || actualVersion.trim() !== expectedVersion) {
    const received = actualVersion.trim() || "no version"
    const detail = diagnosticStderr.trim() ? `: ${diagnosticStderr.trim()}` : ""
    throw new Error(`Expected OpenCode ${expectedVersion}, received ${received}${detail}`)
  }
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

export function createTemporaryRootCleanup(temporaryRoot: string, remove: () => Promise<void>) {
  let removed = false
  let removing: Promise<void> | undefined

  const removeRoot = async (
    environment: Record<string, string | undefined> = process.env,
    timeoutMs = stopTimeoutMs,
  ): Promise<void> => {
    if (removed) return
    if (!removing) {
      removing = remove().then(() => {
        removed = true
      })
    }
    const attempt = removing
    try {
      await requireWithin(attempt, timeoutMs, `Cleanup timed out after ${timeoutMs}ms`)
    } catch (error) {
      throw new Error(redactOutput(errorText(error), temporaryRoot, environment))
    } finally {
      if (!removed && removing === attempt) removing = undefined
    }
  }

  return {
    async afterStartFailure(
      error: unknown,
      stderr: string,
      environment: Record<string, string | undefined> = process.env,
    ): Promise<never> {
      const reason = redactOutput(errorText(error), temporaryRoot, environment)
      const diagnostic = redactOutput(stderr, temporaryRoot, environment)
      try {
        await removeRoot(environment)
      } catch (cleanupError) {
        throw new Error(`${reason}\nOpenCode stderr:\n${diagnostic}\nCleanup failed: ${errorText(cleanupError)}`)
      }
      throw new Error(`${reason}\nOpenCode stderr:\n${diagnostic}`)
    },
    remove: removeRoot,
  }
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
  await assertOpenCodeVersion()

  const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-memory-e2e-"))
  const cleanup = createTemporaryRootCleanup(temporaryRoot, () => rm(temporaryRoot, { force: true, recursive: true }))
  const deadline = Date.now() + startupTimeoutMs
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
          let processCleanupFailure: unknown
          try {
            await terminateProcess(child)
          } catch (cleanupError) {
            processCleanupFailure = cleanupError
          }
          await settleWithin(stderrReader, terminateStepTimeoutMs)
          diagnosticStderr += redactOutput(rawStderr, temporaryRoot)
          if (processCleanupFailure) {
            throw new Error(`${errorText(error)}\nProcess cleanup failed: ${errorText(processCleanupFailure)}`)
          }
          throw error
        }
      },
    })

    let stopped = false
    const stop = async () => {
      if (stopped) return
      const stopDeadline = Date.now() + stopTimeoutMs
      let stopFailure: unknown
      try {
        await terminateProcess(started.child, {
          timeoutMs: Math.min(terminateStepTimeoutMs, Math.max(1, stopDeadline - Date.now())),
        })
        await settleWithin(started.stderrReader, Math.max(1, stopDeadline - Date.now()))
      } catch (error) {
        stopFailure = error
      }
      try {
        await cleanup.remove(process.env, stopDeadline - Date.now())
      } catch (cleanupError) {
        const reason = stopFailure ? `${errorText(stopFailure)}\n` : ""
        throw new Error(redactOutput(`${reason}Cleanup failed: ${errorText(cleanupError)}`, temporaryRoot))
      }
      if (stopFailure) throw new Error(redactOutput(errorText(stopFailure), temporaryRoot))
      stopped = true
    }

    return {
      baseUrl: started.baseUrl,
      projectDir,
      stderr: () => redactOutput(started.rawStderr(), temporaryRoot),
      stop,
    }
  } catch (error) {
    return await cleanup.afterStartFailure(error, diagnosticStderr)
  }
}
