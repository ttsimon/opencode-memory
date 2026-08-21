import type { Config } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"

const commands = {
  memory: { action: "overview", description: "Show memory overview" },
  "memory-status": { action: "status", description: "Show memory status" },
  "memory-search": { action: "search", description: "Search memories" },
  "memory-show": { action: "show", description: "Show one memory" },
  remember: { action: "remember", description: "Save a memory" },
  forget: { action: "forget", description: "Soft-delete a memory" },
  "memory-enable": { action: "enable", description: "Enable memory for this project" },
  "memory-disable": { action: "disable", description: "Disable memory for this project" },
} as const

const automaticCommands = {
  "memory-history": { action: "history", description: "Show memory audit history" },
  "memory-doctor": { action: "doctor", description: "Diagnose memory health" },
} as const

export const memoryCommandNames = Object.keys(commands) as Array<keyof typeof commands>

export function registerCommands(config: Config, includeAutomatic: boolean): void {
  config.command ??= {}
  for (const [name, definition] of Object.entries(commands)) {
    config.command[name] ??= {
      description: definition.description,
      template: commandInstruction(definition.action, "$ARGUMENTS"),
    }
  }
  if (includeAutomatic) {
    for (const [name, definition] of Object.entries(automaticCommands)) {
      config.command[name] ??= {
        description: definition.description,
        template: commandInstruction(definition.action, "$ARGUMENTS"),
      }
    }
  }
}

export function routeMemoryCommand(
  input: { readonly command: string; readonly arguments: string },
  output: { readonly parts: Part[] },
): void {
  const definition =
    commands[input.command as keyof typeof commands] ??
    automaticCommands[input.command as keyof typeof automaticCommands]
  if (!definition) return
  const text = output.parts.find((part) => part.type === "text")
  if (text?.type === "text") text.text = commandInstruction(definition.action, input.arguments)
}

function commandInstruction(action: string, arguments_: string): string {
  const hasArguments = arguments_.trim().length > 0 && arguments_ !== "$ARGUMENTS"
  const argumentName = !hasArguments
    ? undefined
    : action === "remember"
      ? "text"
      : ["show", "history"].includes(action)
        ? "id"
        : ["search", "forget"].includes(action)
          ? "query"
          : undefined
  return [
    `Call the memory tool exactly once with action "${action}"${argumentName ? ` and ${argumentName} "${arguments_}"` : arguments_ === "$ARGUMENTS" ? ` and map optional command arguments to ${action === "remember" ? "text" : ["show", "history"].includes(action) ? "id" : "query"}` : ""}.`,
    "Do not infer or invent database results.",
    "Return the tool output verbatim.",
  ].join("\n")
}
