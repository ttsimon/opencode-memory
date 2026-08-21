import type { Message, Part, Todo } from "@opencode-ai/sdk"
import type { PluginServices } from "../plugin/hooks"
import { inspectSensitive } from "../security/filter"
import { redactDiagnostic } from "../security/redaction"
import { extractImmediateCandidates } from "./extraction"

export interface SessionMessage {
  readonly info: Message
  readonly parts: readonly Part[]
}

export async function finalizeSession(services: PluginServices, sessionId: string): Promise<void> {
  if (!services.database || !services.project || !services.taskService || !services.messages) return
  let pendingKey = `idle:${sessionId}:unknown`
  let projectMemoryChanged = false
  let globalMemoryChanged = false
  try {
    const unknownFailure = services.database.raw
      .query<{ attempts: number }, [string]>("SELECT attempts FROM pending_events WHERE event_key = ?")
      .get(pendingKey)
    if (unknownFailure && unknownFailure.attempts >= 3) return
    const messages = (await services.messages(sessionId)).slice(-100)
    const lastAssistant = [...messages].reverse().find((message) => message.info.role === "assistant")
    const eventKey = `${sessionId}:idle:${lastAssistant?.info.id ?? "none"}`
    pendingKey = `idle:${eventKey}`
    const existing = services.database.raw
      .query<{ attempts: number }, [string]>("SELECT attempts FROM pending_events WHERE event_key = ?")
      .get(pendingKey)
    if (existing && existing.attempts >= 3) return
    if (isProcessed(services, eventKey)) return

    const state = services.state.get(sessionId)
    const goal = safeText(firstUserText(messages)) ?? "Continue the current project task"
    const safeTodos = state.todos.filter((todo) => inspectSensitive(todo.content).safe)
    const completed = safeTodos.filter((todo) => todo.status === "completed").map((todo) => todo.content)
    const inProgress = state.todos
      .filter((todo) => inspectSensitive(todo.content).safe)
      .filter((todo) => todo.status !== "completed" && todo.status !== "cancelled")
      .map((todo) => todo.content)
    const assistantText = lastAssistant ? textContent(lastAssistant.parts) : ""
    const assistantTime = lastAssistant?.info.role === "assistant" ? lastAssistant.info.time : undefined
    const observedAt = new Date(assistantTime?.completed ?? assistantTime?.created ?? Date.now()).toISOString()
    const nextSteps = inProgress.length > 0 ? inProgress : extractNextSteps(assistantText)
    services.database.raw.transaction(() => {
      for (const message of messages) {
        if (message.info.role !== "user" || !services.memory) continue
        const text = textContent(message.parts)
        for (const candidate of extractImmediateCandidates({
          text,
          projectId: services.project?.projectId ?? "",
          sessionId,
          messageId: message.info.id,
        })) {
          if (candidate.confidence >= 0.85) {
            const result = services.memory.remember(candidate)
            if (result.outcome === "rejected") continue
            if (result.memory.scope === "project") projectMemoryChanged = true
            else globalMemoryChanged = true
          }
        }
      }
      const allCompleted = safeTodos.length > 0 && safeTodos.every((todo) => todo.status === "completed")
      if (allCompleted)
        services.taskService?.archive(services.project?.projectId ?? "", "completed", observedAt, sessionId)
      else
        services.taskService?.replace({
          projectId: services.project?.projectId ?? "",
          goal,
          status: "active",
          completed,
          inProgress,
          files: state.currentFiles.filter((file) => inspectSensitive(file).safe),
          decisions: extractDecisions(assistantText).filter((item) => inspectSensitive(item).safe),
          blockers: extractBlockers(assistantText).filter((item) => inspectSensitive(item).safe),
          nextSteps: nextSteps.filter((item) => inspectSensitive(item).safe),
          sourceSessionId: sessionId,
          updatedAt: observedAt,
        })
      services.database?.raw.query("DELETE FROM pending_events WHERE event_key = ?").run(pendingKey)
    })()
    if (projectMemoryChanged) await services.projection?.rebuildProject(services.project.projectId)
    if (globalMemoryChanged) await services.projection?.rebuildGlobal()
    services.database.raw
      .query("INSERT INTO processed_events (event_key, processed_at) VALUES (?, ?)")
      .run(eventKey, new Date().toISOString())
  } catch (error) {
    recordPendingFailure(services, sessionId, pendingKey, error)
  }
}

export function updateTodos(services: PluginServices, sessionId: string, todos: readonly Todo[]): void {
  services.state.setTodos(sessionId, todos)
}

function recordPendingFailure(services: PluginServices, sessionId: string, eventKey: string, error: unknown): void {
  const now = new Date().toISOString()
  const message = redactDiagnostic(error instanceof Error ? error.message : String(error))
  const metadata = JSON.stringify({ sessionId, error: message.slice(0, 200) })
  services.database?.raw
    .query(`
      INSERT INTO pending_events (event_key, operation, metadata_json, attempts, next_attempt_at, created_at, updated_at)
      VALUES (?, 'session_idle', ?, 1, NULL, ?, ?)
      ON CONFLICT(event_key) DO UPDATE SET
        metadata_json = excluded.metadata_json,
        attempts = MIN(pending_events.attempts + 1, 3),
        updated_at = excluded.updated_at
    `)
    .run(eventKey, metadata, now, now)
}

function isProcessed(services: PluginServices, eventKey: string): boolean {
  return Boolean(
    services.database?.raw
      .query<{ event_key: string }, [string]>("SELECT event_key FROM processed_events WHERE event_key = ?")
      .get(eventKey),
  )
}

function firstUserText(messages: readonly SessionMessage[]): string | undefined {
  for (const message of messages) {
    if (message.info.role !== "user") continue
    const text = textContent(message.parts).trim()
    if (text) return text.split(/[.!?\n]/)[0]?.trim()
  }
  return undefined
}

function safeText(text: string | undefined): string | undefined {
  return text && inspectSensitive(text).safe ? text : undefined
}

function textContent(parts: readonly Part[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function extractNextSteps(text: string): string[] {
  const match = text.match(/next step(?:s)?:\s*([^\n.]+)/i)
  return match?.[1] ? [match[1].trim()] : []
}

function extractDecisions(text: string): string[] {
  return text
    .split(/\n|\./)
    .map((line) => line.trim())
    .filter((line) => /\b(decided|decision)\b/i.test(line))
}

function extractBlockers(text: string): string[] {
  return text
    .split(/\n|\./)
    .map((line) => line.trim())
    .filter((line) => /\b(blocked|blocker|risk)\b/i.test(line))
}
