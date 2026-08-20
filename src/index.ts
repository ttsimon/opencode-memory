import { tool, type Plugin } from "@opencode-ai/plugin"

export const OpenCodeMemoryPlugin: Plugin = async () => ({
  tool: {
    memory: tool({
      description: "Inspect OpenCode Memory plugin health.",
      args: {
        action: tool.schema.literal("health"),
      },
      async execute() {
        return "OpenCode Memory is loaded."
      },
    }),
  },
})

export default OpenCodeMemoryPlugin
