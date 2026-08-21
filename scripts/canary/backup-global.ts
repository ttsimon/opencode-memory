import { chmod, cp, mkdir, stat } from "node:fs/promises"
import { basename, join } from "node:path"

export async function backupGlobalConfig(configDir: string, backupRoot: string): Promise<string> {
  const target = join(backupRoot, `opencode-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  await mkdir(target, { recursive: false, mode: 0o700 })
  if (process.platform !== "win32") await chmod(target, 0o700)
  for (const name of ["opencode.json", "package.json", "package-lock.json", "bun.lock", "plugins"]) {
    const source = join(configDir, name)
    if ((await stat(source).catch(() => undefined)) !== undefined)
      await cp(source, join(target, basename(source)), { recursive: true })
  }
  return target
}
