import { expect, test } from "bun:test"
import {
  assertOpenCodeVersion,
  createTemporaryRootCleanup,
  redactOutput,
  removeTemporaryRoot,
  runWithPortRetries,
  stopServerResources,
  terminateProcess,
} from "../helpers/opencode-server"

test("redactOutput removes temporary paths and secrets from diagnostics", () => {
  const output = redactOutput("root=C:\\temp\\run token=hunter2", "C:\\temp\\run", {
    API_TOKEN: "hunter2",
  })

  expect(output).toBe("root=<temporary-root> token=<redacted:API_TOKEN>")
  expect(output).not.toContain("hunter2")
})

test("terminateProcess reports failure when Unix remains alive after KILL", async () => {
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

  await expect(terminateProcess(child, { platform: "linux", timeoutMs: 10 })).rejects.toThrow(
    "did not exit after SIGKILL",
  )

  expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  expect(performance.now() - startedAt).toBeLessThan(100)
})

test("terminateProcess reports failure when Windows remains alive after taskkill", async () => {
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

  await expect(
    terminateProcess(child, {
      platform: "win32",
      runTaskkill: async (args) => {
        taskkillCalls.push(args)
      },
      timeoutMs: 10,
    }),
  ).rejects.toThrow("did not exit after taskkill")

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

test("terminateProcess always cleans the Windows process tree after direct child exit", async () => {
  const taskkillCalls: string[][] = []
  const child = {
    exited: Promise.resolve(0),
    exitCode: null,
    kill() {},
    pid: 987,
  }

  await terminateProcess(child, {
    platform: "win32",
    runTaskkill: async (args) => {
      taskkillCalls.push(args)
      throw new Error("process not found")
    },
    timeoutMs: 10,
  })

  expect(taskkillCalls).toEqual([["/PID", "987", "/T", "/F"]])
})

test("terminateProcess reports non-missing Windows process-tree cleanup failures", async () => {
  const child = {
    exited: Promise.resolve(0),
    exitCode: 0,
    kill() {},
    pid: 654,
  }

  await expect(
    terminateProcess(child, {
      platform: "win32",
      runTaskkill: async () => {
        throw new Error("access denied")
      },
      timeoutMs: 10,
    }),
  ).rejects.toThrow("taskkill failed: access denied")
})

test("terminateProcess reports a bounded taskkill timeout even after direct child exit", async () => {
  const child = {
    exited: Promise.resolve(0),
    exitCode: 0,
    kill() {},
    pid: 655,
  }

  await expect(
    terminateProcess(child, {
      platform: "win32",
      runTaskkill: async () => await new Promise<void>(() => {}),
      timeoutMs: 10,
    }),
  ).rejects.toThrow("taskkill timed out")
})

test("OpenCode version detection is asynchronous, bounded, and terminates on timeout", async () => {
  const signals: string[] = []
  const child = {
    exited: new Promise<number>(() => {}),
    exitCode: null,
    kill(signal?: number | NodeJS.Signals) {
      signals.push(String(signal ?? "SIGTERM"))
    },
    pid: 321,
    stderr: new Blob([""]).stream(),
    stdout: new Blob([""]).stream(),
  }
  const startedAt = performance.now()

  await expect(
    assertOpenCodeVersion({
      platform: "linux",
      spawn: () => child,
      timeoutMs: 10,
    }),
  ).rejects.toThrow("OpenCode version check timed out")

  expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  expect(performance.now() - startedAt).toBeLessThan(100)
})

test("temporary root cleanup remains retryable and redacts stop failures", async () => {
  let attempts = 0
  const cleanup = createTemporaryRootCleanup("C:\\temp\\secret-root", async () => {
    attempts += 1
    if (attempts === 1) throw new Error("cannot remove C:\\temp\\secret-root token=hunter2")
  })

  await expect(cleanup.remove({ API_TOKEN: "hunter2" })).rejects.toThrow(
    "cannot remove <temporary-root> token=<redacted:API_TOKEN>",
  )
  await cleanup.remove({ API_TOKEN: "hunter2" })
  await cleanup.remove({ API_TOKEN: "hunter2" })

  expect(attempts).toBe(2)
})

test("temporary root cleanup can retry after a bounded removal times out", async () => {
  let attempts = 0
  const cleanup = createTemporaryRootCleanup("C:\\temp\\secret-root", async () => {
    attempts += 1
    if (attempts === 1) await new Promise<void>(() => {})
  })

  await expect(cleanup.remove({}, 10)).rejects.toThrow("Cleanup timed out after 10ms")
  await cleanup.remove({}, 10)

  expect(attempts).toBe(2)
})

test("temporary root removal retries transient Windows filesystem locks", async () => {
  let attempts = 0

  await removeTemporaryRoot("C:\\temp\\run", {
    remove: async () => {
      attempts += 1
      if (attempts < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" })
    },
    sleep: async () => {},
  })

  expect(attempts).toBe(3)
})

test("temporary root cleanup appends a redacted cleanup failure to startup errors", async () => {
  const cleanup = createTemporaryRootCleanup("C:\\temp\\secret-root", async () => {
    throw new Error("rm C:\\temp\\secret-root token=hunter2")
  })

  await expect(
    cleanup.afterStartFailure(new Error("startup failed token=hunter2"), "stderr token=hunter2", {
      API_TOKEN: "hunter2",
    }),
  ).rejects.toThrow(
    "startup failed token=<redacted:API_TOKEN>\nOpenCode stderr:\nstderr token=<redacted:API_TOKEN>\nCleanup failed: rm <temporary-root> token=<redacted:API_TOKEN>",
  )
})

test("server shutdown gives temporary-root cleanup an independent positive timeout", async () => {
  let cleanupTimeout = 0

  await stopServerResources({
    child: {
      exited: Promise.resolve(0),
      exitCode: 0,
      kill() {},
      pid: 123,
    },
    cleanup: {
      async remove(_environment, timeoutMs) {
        cleanupTimeout = timeoutMs ?? 0
      },
    },
    processTimeoutMs: 1,
    stderrReader: Promise.resolve(),
    temporaryRoot: "C:\\temp\\run",
    terminate: async () => {
      await Bun.sleep(5)
    },
  })

  expect(cleanupTimeout).toBe(1)
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
