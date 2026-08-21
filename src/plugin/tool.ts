import { tool } from "@opencode-ai/plugin"
import { classifyManualMemory } from "../domain/classification"
import { redactDiagnostic } from "../security/redaction"
import type { PluginServices } from "./hooks"

const actions = [
  "health",
  "overview",
  "status",
  "search",
  "show",
  "remember",
  "forget",
  "enable",
  "disable",
  "history",
  "doctor",
] as const

export function createMemoryTool(services: PluginServices) {
  return tool({
    description: "Manage local OpenCode Memory records and plugin state.",
    args: {
      action: tool.schema.enum(actions),
      text: tool.schema.string().optional(),
      query: tool.schema.string().optional(),
      id: tool.schema.string().optional(),
    },
    async execute(arguments_, context) {
      if (arguments_.action === "health") return "OpenCode Memory is loaded."
      try {
        if (!services.memory || !services.database || !services.memories || !services.project) {
          return `OpenCode Memory is degraded: ${redactDiagnostic(services.degradedReason ?? "storage unavailable")}`
        }
        const projectId = services.project.projectId
        switch (arguments_.action) {
          case "overview": {
            const memories = services.memory.search("", projectId).slice(0, 20)
            const task = services.tasks?.getActive(projectId)
            return JSON.stringify({ scope: projectId, memories, task }, null, 2)
          }
          case "status":
            return JSON.stringify(
              {
                enabled: isProjectEnabled(services, projectId),
                runtime: services.runtime.status(),
                session: services.state.get(context.sessionID),
              },
              null,
              2,
            )
          case "search":
            return JSON.stringify(services.memory.search(arguments_.query ?? arguments_.text ?? "", projectId), null, 2)
          case "show": {
            const memory = arguments_.id ? services.memory.get(arguments_.id, projectId) : undefined
            return memory ? JSON.stringify(memory, null, 2) : "Memory not found."
          }
          case "remember": {
            if (!arguments_.text?.trim()) return "Memory text is required."
            const result = services.memory.remember({
              ...classifyManualMemory(arguments_.text, projectId),
              sourceSessionId: context.sessionID,
              sourceMessageId: context.messageID,
            })
            if (result.outcome === "rejected") return `Memory rejected: ${result.reasons.join(", ")}`
            services.state.recordWrite(context.sessionID, { outcome: result.outcome, id: result.memory.id })
            if (result.memory.scope === "project") await rebuildProjection(services, projectId)
            else await rebuildGlobalProjection(services)
            return `Saved ${result.memory.scope} ${result.memory.kind} memory ${result.memory.id}.`
          }
          case "forget": {
            const query = arguments_.query ?? arguments_.text
            const before = arguments_.id ? services.memory.get(arguments_.id, projectId) : undefined
            const result = services.memory.forget({
              projectId,
              ...(arguments_.id ? { id: arguments_.id } : {}),
              ...(query ? { query } : {}),
            })
            if (result.outcome === "ambiguous") return `Multiple matches; specify an ID: ${result.ids.join(", ")}`
            if (result.outcome === "not_found") return "Memory not found."
            if (before?.scope === "global") await rebuildGlobalProjection(services)
            else await rebuildProjection(services, projectId)
            return `Soft-deleted memory ${result.id}.`
          }
          case "enable":
            setProjectEnabled(services, projectId, true)
            return "OpenCode Memory enabled for this project."
          case "disable":
            setProjectEnabled(services, projectId, false)
            return "OpenCode Memory disabled for this project."
          case "history": {
            const events = services.memory.history(arguments_.id, projectId)
            return events.length === 0
              ? "No audit history found."
              : events
                  .map(
                    (event) =>
                      `${event.createdAt} ${event.operation}: ${event.fromStatus ?? "none"} -> ${event.toStatus ?? "none"}; session: ${event.sourceSessionId ?? "none"}`,
                  )
                  .join("\n")
          }
          case "doctor":
            return services.doctor
              ? JSON.stringify(await services.doctor.run(services.project), null, 2)
              : "OpenCode Memory doctor is unavailable."
        }
      } catch (error) {
        await services.runtime.reportError(`tool.${arguments_.action}`, error)
        return `OpenCode Memory is degraded: ${redactDiagnostic(error instanceof Error ? error.message : String(error))}`
      }
    },
  })
}

async function rebuildProjection(services: PluginServices, projectId: string): Promise<void> {
  if (!services.projection) return
  try {
    await services.projection.rebuildProject(projectId)
  } catch (error) {
    await services.runtime.reportError("projection", error)
  }
}

async function rebuildGlobalProjection(services: PluginServices): Promise<void> {
  if (!services.projection) return
  try {
    await services.projection.rebuildGlobal()
  } catch (error) {
    await services.runtime.reportError("projection", error)
  }
}

export function isProjectEnabled(services: PluginServices, projectId: string): boolean {
  if (!services.database) return false
  const row = services.database.raw
    .query<{ enabled: number }, [string]>("SELECT enabled FROM settings WHERE scope_key = ?")
    .get(`project:${projectId}`)
  return row?.enabled !== 0
}

function setProjectEnabled(services: PluginServices, projectId: string, enabled: boolean): void {
  services.database?.raw
    .query(`
      INSERT INTO settings (scope_key, enabled, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `)
    .run(`project:${projectId}`, enabled ? 1 : 0, new Date().toISOString())
}
