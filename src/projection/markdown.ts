import { mkdir, readdir, rename, rm } from "node:fs/promises"
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
    await writeProjection(directory, topics, "Project Memory", this.memories.listProjectable(projectId))
  }

  async rebuildGlobal(): Promise<void> {
    const records = this.memories.listProjectableGlobal()
    await mkdir(this.paths.globalTopics, { recursive: true, mode: 0o700 })
    await writeProjection(this.paths.global, this.paths.globalTopics, "Global Memory", records)
  }
}

async function writeProjection(
  directory: string,
  topics: string,
  title: string,
  records: ReturnType<MemoryRepository["listProjectable"]>,
): Promise<void> {
  const grouped = Map.groupBy(records, (memory) => memory.kind)
  const activeKinds = new Set(grouped.keys())
  for (const file of await readdir(topics)) {
    if (file.endsWith(".md") && !activeKinds.has(file.slice(0, -3) as MemoryKind)) await rm(join(topics, file))
  }
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
  const core = records.map((memory) => `- [${memory.kind}] ${escapeMarkdown(memory.content)}`).join("\n")
  const content = `# ${title}\n\nGenerated from SQLite. Do not treat this file as the source of truth.\n\n## Core\n\n${core || "- None"}\n\n## Topics\n\n${links.join("\n") || "- None"}\n`
  if (!inspectSensitive(content).safe) throw new Error("Projection contains sensitive content")
  await atomicWrite(join(directory, "MEMORY.md"), content)
}

function renderTopic(kind: MemoryKind, contents: readonly string[]): string {
  return `# ${kind}\n\nGenerated from SQLite.\n\n${contents.map((content) => `- ${escapeMarkdown(content)}`).join("\n")}\n`
}

function escapeMarkdown(content: string): string {
  return content.replace(/[\\`*_{}[\]<>#|]/g, "\\$&").replace(/\r?\n/g, " ")
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`
  await Bun.write(temporary, content)
  await rename(temporary, target)
}
