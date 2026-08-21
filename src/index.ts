import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { createDegradedServices, createHooks, createServices } from "./plugin/hooks"
import { createRuntime, type RuntimeClient } from "./plugin/runtime"

export const OpenCodeMemoryPlugin: Plugin = async (input, options) => {
  const runtime = createRuntime(input.client as unknown as RuntimeClient, input.directory)
  const services = await createServices(input as PluginInput, options, runtime).catch((error) =>
    createDegradedServices(runtime, input.directory, error),
  )
  return createHooks(services)
}

export default OpenCodeMemoryPlugin
