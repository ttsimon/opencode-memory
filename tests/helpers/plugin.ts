import type { RuntimeClient } from "../../src/plugin/runtime"

export function createFakeRuntimeClient() {
  const logs: Array<Record<string, unknown>> = []
  const toasts: Array<Record<string, unknown>> = []
  const client: RuntimeClient = {
    app: {
      async log(input) {
        logs.push(input.body)
        return true
      },
    },
    tui: {
      async showToast(input) {
        toasts.push(input.body)
        return true
      },
    },
  }
  return { client, logs, toasts }
}
