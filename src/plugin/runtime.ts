import { redactDiagnostic } from "../security/redaction"

interface LogInput {
  readonly body: {
    readonly service: string
    readonly level: "debug" | "info" | "warn" | "error"
    readonly message: string
    readonly extra?: Record<string, unknown>
  }
  readonly query?: { readonly directory?: string }
}

interface ToastInput {
  readonly body: {
    readonly title?: string
    readonly message: string
    readonly variant: "info" | "success" | "warning" | "error"
    readonly duration?: number
  }
  readonly query?: { readonly directory?: string }
}

export interface RuntimeClient {
  readonly app: { log(input: LogInput): Promise<unknown> }
  readonly tui: { showToast(input: ToastInput): Promise<unknown> }
}

export interface RuntimeStatus {
  readonly degraded: boolean
  readonly codes: readonly string[]
}

export interface PluginRuntime {
  guardHook<Arguments extends readonly unknown[]>(
    code: string,
    hook: (...arguments_: Arguments) => Promise<void>,
  ): (...arguments_: Arguments) => Promise<void>
  reportError(code: string, error: unknown): Promise<void>
  warnOnce(code: string, message: string): Promise<void>
  status(): RuntimeStatus
}

export function createRuntime(client: RuntimeClient, directory: string): PluginRuntime {
  const codes = new Set<string>()
  const warnings = new Set<string>()

  const reportError = async (code: string, error: unknown): Promise<void> => {
    codes.add(code)
    const message = redactDiagnostic(error instanceof Error ? error.message : String(error))
    try {
      await client.app.log({
        body: { service: "opencode-memory", level: "error", message, extra: { code } },
        query: { directory },
      })
    } catch {}
    await warnOnce(code, `OpenCode Memory degraded: ${message}`)
  }

  const warnOnce = async (code: string, message: string): Promise<void> => {
    if (warnings.has(code)) return
    warnings.add(code)
    try {
      await client.tui.showToast({
        body: { title: "OpenCode Memory", message: redactDiagnostic(message), variant: "warning", duration: 5_000 },
        query: { directory },
      })
    } catch {}
  }

  return {
    guardHook:
      (code, hook) =>
      async (...arguments_) => {
        try {
          await hook(...arguments_)
        } catch (error) {
          await reportError(code, error)
        }
      },
    reportError,
    warnOnce,
    status: () => ({ degraded: codes.size > 0, codes: [...codes] }),
  }
}
