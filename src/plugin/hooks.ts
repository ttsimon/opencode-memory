import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"
import type { ProjectScope } from "../domain/types"
import { MemoryService } from "../memory-service"
import { resolveDataPaths } from "../paths"
import { resolveProject } from "../project/resolver"
import { RecallEngine } from "../recall/engine"
import { renderRecall } from "../recall/render"
import { AuditRepository } from "../storage/audit-repository"
import { type MemoryDatabase, openDatabase } from "../storage/database"
import { MemoryRepository } from "../storage/memory-repository"
import { TaskRepository } from "../storage/task-repository"
import { registerCommands, routeMemoryCommand } from "./commands"
import type { PluginRuntime } from "./runtime"
import { SessionState } from "./session-state"
import { createMemoryTool, isProjectEnabled } from "./tool"

export interface PluginServices {
  readonly database?: MemoryDatabase
  readonly memory?: MemoryService
  readonly memories?: MemoryRepository
  readonly tasks?: TaskRepository
  readonly recall?: RecallEngine
  readonly state: SessionState
  readonly runtime: PluginRuntime
  readonly project?: ProjectScope
  readonly directory: string
  readonly degradedReason?: string
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
    return {
      database,
      memory: new MemoryService(database, memories, new AuditRepository(database)),
      memories,
      tasks,
      recall: new RecallEngine(memories, tasks),
      state: new SessionState(),
      runtime,
      project,
      directory: input.directory,
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
    async (input: { sessionID: string }, output: { parts: Part[] }) => {
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
    },
  )

  return {
    config: services.runtime.guardHook("config", async (config: Config) => registerCommands(config, false)),
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
    event: async () => {},
    tool: { memory: createMemoryTool(services) },
    dispose: async () => services.dispose(),
  }
}
