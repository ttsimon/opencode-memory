import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Part, Todo } from "@opencode-ai/sdk"
import { MemoryDoctor } from "../diagnostics/doctor"
import type { ProjectScope } from "../domain/types"
import { extractImmediateCandidates } from "../lifecycle/extraction"
import { finalizeSession, type SessionMessage, updateTodos } from "../lifecycle/finalization"
import { MemoryService } from "../memory-service"
import { resolveDataPaths } from "../paths"
import { resolveProject } from "../project/resolver"
import { MarkdownProjection } from "../projection/markdown"
import { RecallEngine } from "../recall/engine"
import { renderRecall } from "../recall/render"
import { AuditRepository } from "../storage/audit-repository"
import { type MemoryDatabase, openDatabase } from "../storage/database"
import { MemoryRepository } from "../storage/memory-repository"
import { TaskRepository } from "../storage/task-repository"
import { TaskService } from "../task-service"
import { registerCommands, routeMemoryCommand } from "./commands"
import type { PluginRuntime } from "./runtime"
import { SessionState } from "./session-state"
import { createMemoryTool, isProjectEnabled } from "./tool"

export interface PluginServices {
  readonly database?: MemoryDatabase
  readonly memory?: MemoryService
  readonly memories?: MemoryRepository
  readonly tasks?: TaskRepository
  readonly taskService?: Pick<TaskService, "getActive" | "replace" | "archive">
  readonly recall?: RecallEngine
  readonly state: SessionState
  readonly runtime: PluginRuntime
  readonly project?: ProjectScope
  readonly directory: string
  readonly degradedReason?: string
  readonly doctor?: MemoryDoctor
  readonly projection?: MarkdownProjection
  readonly messages?: (sessionId: string) => Promise<readonly SessionMessage[]>
  dispose(): void
}

export async function createServices(
  input: PluginInput,
  _options: unknown,
  runtime: PluginRuntime,
): Promise<PluginServices> {
  const paths = resolveDataPaths(process.env, process.platform)
  const database = await openDatabase(paths)
  try {
    const project = await resolveProject({ directory: input.directory, worktree: input.worktree })
    const memories = new MemoryRepository(database)
    const tasks = new TaskRepository(database)
    const audit = new AuditRepository(database)
    return {
      database,
      memory: new MemoryService(database, memories, audit),
      memories,
      tasks,
      taskService: new TaskService(database, tasks, audit),
      recall: new RecallEngine(memories, tasks),
      state: new SessionState(),
      runtime,
      project,
      directory: input.directory,
      doctor: new MemoryDoctor(database, paths),
      projection: new MarkdownProjection(paths, memories),
      messages: async (sessionId) => {
        const response = await input.client.session.messages({
          path: { id: sessionId },
          query: { directory: input.directory, limit: 100 },
        })
        if (response.error) throw new Error(`Failed to load session messages: ${JSON.stringify(response.error)}`)
        return response.data ?? []
      },
      dispose: () => database.close(),
    }
  } catch (error) {
    database.close()
    throw error
  }
}

export function createDegradedServices(runtime: PluginRuntime, directory: string, error: unknown): PluginServices {
  return {
    state: new SessionState(),
    runtime,
    directory,
    degradedReason: error instanceof Error ? error.message : String(error),
    dispose() {},
  }
}

export function createHooks(services: PluginServices): Hooks {
  const onChatMessage = services.runtime.guardHook(
    "chat.message",
    async (input: { sessionID: string; messageID?: string }, output: { parts: Part[] }) => {
      if (!services.project || !services.recall || !isProjectEnabled(services, services.project.projectId)) return
      const text = output.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      for (const part of output.parts) {
        if (part.type === "file" && part.filename) services.state.addCurrentFile(input.sessionID, part.filename)
      }
      services.state.setRecall(
        input.sessionID,
        services.recall.recall({
          projectId: services.project.projectId,
          query: text,
          recentTopics: services.state.get(input.sessionID).recentTopics,
          currentFiles: services.state.get(input.sessionID).currentFiles,
          now: new Date(),
        }),
      )
      if (services.memory && input.messageID) {
        let created = 0
        for (const candidate of extractImmediateCandidates({
          text,
          projectId: services.project.projectId,
          sessionId: input.sessionID,
          messageId: input.messageID,
        })) {
          if (candidate.confidence < 0.85) continue
          const result = services.memory.remember(candidate)
          if (result.outcome === "created") {
            created += 1
            services.state.recordWrite(input.sessionID, { outcome: result.outcome, id: result.memory.id })
            if (result.memory.scope === "project") await services.projection?.rebuildProject(services.project.projectId)
            else await services.projection?.rebuildGlobal()
          }
        }
        if (created > 0)
          await services.runtime.notify(`Saved ${created} memory item${created === 1 ? "" : "s"}.`, "success")
      }
    },
  )

  return {
    config: services.runtime.guardHook("config", async (config: Config) => registerCommands(config, true)),
    "chat.message": onChatMessage,
    "experimental.chat.system.transform": services.runtime.guardHook(
      "system.transform",
      async (input: { sessionID?: string }, output: { system: string[] }) => {
        if (!input.sessionID) return
        const recall = services.state.consumeRecall(input.sessionID)
        if (!recall) return
        const rendered = renderRecall(recall)
        if (rendered) output.system.push(rendered)
        services.recall?.markInjected(recall)
      },
    ),
    "command.execute.before": services.runtime.guardHook(
      "command.before",
      async (input: { command: string; arguments: string }, output: { parts: Part[] }) =>
        routeMemoryCommand(input, output),
    ),
    "experimental.session.compacting": services.runtime.guardHook(
      "session.compacting",
      async (input: { sessionID: string }, output: { context: string[]; prompt?: string }) => {
        if (services.project && services.database && !isProjectEnabled(services, services.project.projectId)) return
        const task = services.project ? services.taskService?.getActive(services.project.projectId) : undefined
        const lines = [
          "Preserve the current task goal and status.",
          "Preserve key decisions and their reasons.",
          "Preserve blockers, risks, relevant files, and next steps.",
          "Do not copy sensitive information into the summary or memory candidates.",
        ]
        if (task) {
          lines.push(
            `Goal: ${task.goal}`,
            `Status: ${task.status}`,
            `Relevant files: ${task.files.join(", ") || "None"}`,
            `Decisions: ${task.decisions.join("; ") || "None"}`,
            `Blockers: ${task.blockers.join("; ") || "None"}`,
            `Next steps: ${task.nextSteps.join("; ") || "None"}`,
          )
        }
        output.context.push(lines.join("\n"))
        services.state.addRecentTopic(input.sessionID, "compaction")
      },
    ),
    event: services.runtime.guardHook("event", async ({ event }) => {
      if (event.type === "todo.updated") {
        const properties = event.properties as { sessionID: string; todos: Todo[] }
        updateTodos(services, properties.sessionID, properties.todos)
      }
      if (event.type === "file.edited") {
        // OpenCode 1.18.18 does not include a session ID, so attribution would leak context across sessions.
      }
      if (event.type === "session.idle") {
        const properties = event.properties as { sessionID: string }
        if (services.project && isProjectEnabled(services, services.project.projectId)) {
          await finalizeSession(services, properties.sessionID)
        }
      }
      if (event.type === "session.deleted") {
        const properties = event.properties as { info: { id: string } }
        services.state.cleanup(properties.info.id)
      }
    }),
    tool: { memory: createMemoryTool(services) },
    dispose: async () => services.dispose(),
  }
}
