import { expect, test } from "bun:test"
import { createRuntime } from "../../src/plugin/runtime"
import { createFakeRuntimeClient } from "../helpers/plugin"

test("hook errors are swallowed, redacted and warned once", async () => {
  const fake = createFakeRuntimeClient()
  const runtime = createRuntime(fake.client, "C:/project")
  const guarded = runtime.guardHook("chat.message", async () => {
    throw new Error("password=hunter2")
  })

  await guarded()
  await guarded()

  expect(fake.toasts).toHaveLength(1)
  expect(JSON.stringify(fake.logs)).not.toContain("hunter2")
  expect(JSON.stringify(fake.logs)).toContain("[REDACTED:password]")
  expect(runtime.status()).toMatchObject({ degraded: true, codes: ["chat.message"] })
})

test("logging and toast failures never escape a guarded hook", async () => {
  const runtime = createRuntime(
    {
      app: {
        async log() {
          throw new Error("log failed")
        },
      },
      tui: {
        async showToast() {
          throw new Error("toast failed")
        },
      },
    },
    "C:/project",
  )
  const guarded = runtime.guardHook("event", async () => {
    throw new Error("db locked")
  })
  await expect(guarded()).resolves.toBeUndefined()
})
