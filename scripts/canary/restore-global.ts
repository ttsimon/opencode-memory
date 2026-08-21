import { cp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

export async function restoreGlobalConfig(backup: string, configDir: string): Promise<void> {
  const entries = await readdir(backup)
  if (!entries.includes("opencode.json") || !entries.includes("package.json"))
    throw new Error("Incomplete OpenCode backup")
  for (const name of ["opencode.json", "package.json", "package-lock.json", "bun.lock", "plugins"]) {
    await rm(join(configDir, name), { recursive: true, force: true })
    if (entries.includes(name)) await cp(join(backup, name), join(configDir, name), { recursive: true })
  }
}
