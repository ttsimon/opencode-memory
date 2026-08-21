import { chmod, mkdir } from "node:fs/promises"
import { posix, win32 } from "node:path"
import type { DataPaths } from "./domain/types"

type Environment = Record<string, string | undefined>

export function resolveDataPaths(environment: Environment, platform: NodeJS.Platform): DataPaths {
  const path = platform === "win32" ? win32 : posix
  let base: string

  if (platform === "win32") {
    base = requireEnvironment(environment, "LOCALAPPDATA")
  } else if (platform === "darwin") {
    base = path.join(requireEnvironment(environment, "HOME"), "Library", "Application Support")
  } else {
    base = environment.XDG_DATA_HOME ?? path.join(requireEnvironment(environment, "HOME"), ".local", "share")
  }

  const root = path.join(base, "opencode-memory")
  const global = path.join(root, "global")
  return {
    root,
    database: path.join(root, "memory.db"),
    backups: path.join(root, "backups"),
    global,
    globalMemory: path.join(global, "MEMORY.md"),
    globalTopics: path.join(global, "topics"),
    projects: path.join(root, "projects"),
  }
}

export async function ensureDataPaths(paths: DataPaths, platform: NodeJS.Platform): Promise<void> {
  const directories = [paths.root, paths.backups, paths.global, paths.globalTopics, paths.projects]
  for (const directory of directories) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (platform !== "win32") await chmod(directory, 0o700)
  }
}

function requireEnvironment(environment: Environment, name: "HOME" | "LOCALAPPDATA"): string {
  const value = environment[name]
  if (!value) throw new Error(`${name} is required to resolve the OpenCode Memory data directory`)
  return value
}
