import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"

interface PartialManifest {
  package: { name: string; version: string }
  tarball: { path: string; sha256: string; files: readonly string[] }
}

export function validateNoLiteralProviderSecrets(config: Record<string, unknown>): void {
  const providers =
    config.provider && typeof config.provider === "object" ? (config.provider as Record<string, unknown>) : {}
  for (const provider of Object.values(providers)) {
    if (!provider || typeof provider !== "object") continue
    const options = (provider as { options?: unknown }).options
    if (!options || typeof options !== "object") continue
    const apiKey = (options as { apiKey?: unknown }).apiKey
    if (typeof apiKey === "string" && !/^\{env:[A-Z0-9_]+\}$/.test(apiKey)) {
      throw new Error("Cannot install canary: rotate and migrate provider secrets to {env:VAR} first")
    }
  }
}

export function patchGlobalConfig(configText: string, packageText: string, manifest: PartialManifest) {
  const config = parseJsonc(configText, "opencode.json") as Record<string, unknown>
  const packageJson = parseJsonc(packageText, "package.json") as { dependencies?: Record<string, string> }
  validateNoLiteralProviderSecrets(config)
  const pluginEntry = pathToFileURL(
    join(process.env.OPENCODE_CONFIG_DIR ?? "", "node_modules", "@ttsimon", "opencode-memory", "dist", "index.js"),
  ).href
  const plugins = Array.isArray(config.plugin)
    ? config.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
  const nextPlugins = [...plugins.filter((entry) => !entry.includes("@ttsimon/opencode-memory")), pluginEntry]
  const dependencies = { ...(packageJson.dependencies ?? {}), [manifest.package.name]: `file:${manifest.tarball.path}` }
  return {
    config: { ...config, plugin: nextPlugins },
    packageJson: { ...packageJson, dependencies },
    configText: patchJsonc(configText, ["plugin"], nextPlugins),
    packageText: `${JSON.stringify({ ...packageJson, dependencies }, null, 2)}\n`,
  }
}

function patchJsonc(text: string, path: (string | number)[], value: unknown): string {
  return applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
}

function parseJsonc(text: string, source: string): unknown {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0 || !value || typeof value !== "object") throw new Error(`Invalid ${source}`)
  return value
}
