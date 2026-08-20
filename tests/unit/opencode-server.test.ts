import { expect, test } from "bun:test"
import { redactOutput, runWithPortRetries, terminateProcess } from "../helpers/opencode-server"

test("redactOutput removes temporary paths and secrets from diagnostics", () => {
  const output = redactOutput("root=C:\\temp\\run token=hunter2", "C:\\temp\\run", {
    API_TOKEN: "hunter2",
  })

  expect(output).toBe("root=<temporary-root> token=<redacted:API_TOKEN>")
  expect(output).not.toContain("hunter2")
})

test("terminateProcess escalates from TERM to KILL on Unix within a bound", async () => {
  const signals: string[] = []
  const child = {
    exited: new Promise<number>(() => {}),
    exitCode: null,
    kill(signal?: number | NodeJS.Signals) {
      signals.push(String(signal ?? "SIGTERM"))
    },
    pid: 123,
  }
  const startedAt = performance.now()

  await terminateProcess(child, { platform: "linux", timeoutMs: 10 })

  expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  expect(performance.now() - startedAt).toBeLessThan(100)
})

test("terminateProcess falls back to taskkill for a stuck Windows process tree", async () => {
  const signals: string[] = []
  const taskkillCalls: string[][] = []
  const child = {
    exited: new Promise<number>(() => {}),
    exitCode: null,
    kill(signal?: number | NodeJS.Signals) {
      signals.push(String(signal ?? "default"))
    },
    pid: 456,
  }

  await terminateProcess(child, {
    platform: "win32",
    runTaskkill: async (args) => {
      taskkillCalls.push(args)
    },
    timeoutMs: 10,
  })

  expect(signals).toEqual(["default"])
  expect(taskkillCalls).toEqual([["/PID", "456", "/T", "/F"]])
})

test("terminateProcess uses taskkill when direct Windows termination throws", async () => {
  const taskkillCalls: string[][] = []
  const child = {
    exited: Promise.resolve(1),
    exitCode: null,
    kill() {
      throw new Error("access denied")
    },
    pid: 789,
  }

  await terminateProcess(child, {
    platform: "win32",
    runTaskkill: async (args) => {
      taskkillCalls.push(args)
    },
    timeoutMs: 10,
  })

  expect(taskkillCalls).toEqual([["/PID", "789", "/T", "/F"]])
})

test("runWithPortRetries retries address conflicts but respects its deadline", async () => {
  let attempts = 0
  const startedAt = performance.now()

  await expect(
    runWithPortRetries({
      deadline: Date.now() + 250,
      maxAttempts: 100,
      start: async () => {
        attempts += 1
        throw new Error("EADDRINUSE")
      },
    }),
  ).rejects.toThrow("Could not start OpenCode on an available port")

  expect(attempts).toBeGreaterThan(1)
  expect(attempts).toBeLessThan(100)
  expect(performance.now() - startedAt).toBeLessThan(500)
})

test("runWithPortRetries does not retry unrelated startup failures", async () => {
  let attempts = 0

  await expect(
    runWithPortRetries({
      deadline: Date.now() + 1_000,
      start: async () => {
        attempts += 1
        throw new Error("invalid config")
      },
    }),
  ).rejects.toThrow("invalid config")

  expect(attempts).toBe(1)
})
