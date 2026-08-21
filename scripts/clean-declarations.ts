import { readdir, rm } from "node:fs/promises"
import { join, relative } from "node:path"

async function removeInternalDeclarations(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await removeInternalDeclarations(path)
      if ((await readdir(path)).length === 0) await rm(path, { recursive: true })
      continue
    }
    if (relative("dist", path).replaceAll("\\", "/") !== "index.d.ts" && entry.name.endsWith(".d.ts")) {
      await rm(path)
    }
  }
}

await removeInternalDeclarations("dist")
