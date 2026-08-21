import { mkdir, rename } from "node:fs/promises"
import { join } from "node:path"
import type { DataPaths, MemoryKind } from "../domain/types"
import { inspectSensitive } from "../security/filter"
import type { MemoryRepository } from "../storage/memory-repository"

export class MarkdownProjection {
  constructor(
    private readonly paths: DataPaths,
    private readonly memories: MemoryRepository,
  ) {}

  async rebuildProject(projectId: string): Promise<void> {
    const directory = join(this.paths.projects, projectId)
    const topics = join(directory, "topics")
    await mkdir(topics, { recursive: true, mode: 0o700 })
    const records = this.memories.listProjectable(projectId)
    const grouped = Map.groupBy(records, (memory) => memory.kind)
    const links: string[] = []
    for (const [kind, items] of grouped) {
      const content = renderTopic(
        kind,
        items.map((item) => item.content),
      )
      if (!inspectSensitive(content).safe) continue
      await atomicWrite(join(topics, `${kind}.md`), content)
      links.push(`- [${kind}](topics/${kind}.md)`)
    }
    const core = records.map((memory) => `- [${memory.kind}] ${memory.content}`).join("\n")
    const content = `# Project Memory\n\nGenerated from SQLite. Do not treat this file as the source of truth.\n\n## Core\n\n${core || "- None"}\n\n## Topics\n\n${links.join("\n") || "- None"}\n`
    if (!inspectSensitive(content).safe) throw new Error("Projection contains sensitive content")
    await atomicWrite(join(directory, "MEMORY.md"), content)
  }
}

function renderTopic(kind: MemoryKind, contents: readonly string[]): string {
  return `# ${kind}\n\nGenerated from SQLite.\n\n${contents.map((content) => `- ${content}`).join("\n")}\n`
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`
  await Bun.write(temporary, content)
  await rename(temporary, target)
}
