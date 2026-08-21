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
    config.command["memory-history"] ??= {
      description: "Show memory audit history",
      template: commandInstruction("history", "$ARGUMENTS"),
    }
    config.command["memory-doctor"] ??= {
      description: "Diagnose memory health",
      template: commandInstruction("doctor", "$ARGUMENTS"),
    }
  }
}

export function routeMemoryCommand(
  input: { readonly command: string; readonly arguments: string },
  output: { readonly parts: Part[] },
): void {
  const definition = commands[input.command as keyof typeof commands]
  if (!definition) return
  const text = output.parts.find((part) => part.type === "text")
  if (text?.type === "text") text.text = commandInstruction(definition.action, input.arguments)
}

function commandInstruction(action: string, arguments_: string): string {
  return [
    `Call the memory tool exactly once with action "${action}" and input "${arguments_}".`,
    "Do not infer or invent database results.",
    "Return the tool output verbatim.",
  ].join("\n")
}
