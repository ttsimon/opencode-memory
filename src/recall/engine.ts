import type { MemoryKind, MemoryRecord, MemoryScope, TaskSnapshot } from "../domain/types"
import type { MemoryRepository } from "../storage/memory-repository"
import type { TaskRepository } from "../storage/task-repository"
import { estimateRecallTokens } from "./render"

export interface RecallInput {
  readonly projectId: string
  readonly query: string
  readonly recentTopics: readonly string[]
  readonly currentFiles: readonly string[]
  readonly now: Date
  readonly tokenBudget?: number
}

export interface RecallItem {
  readonly id: string
  readonly scope: MemoryScope
  readonly kind: MemoryKind
  readonly content: string
  readonly updatedAt: string
}

export interface RecallResult {
  readonly items: RecallItem[]
  readonly task: TaskSnapshot | undefined
  readonly counts: {
    readonly globalCore: number
    readonly projectCore: number
    readonly dynamic: number
    readonly task: number
  }
  readonly estimatedTokens: number
}

interface ScoredMemory {
  readonly memory: MemoryRecord
  readonly group: "globalCore" | "projectCore" | "dynamic"
  readonly score: number
}

export class RecallEngine {
  constructor(
    private readonly memories: MemoryRepository,
    private readonly tasks: TaskRepository,
  ) {}

  recall(input: RecallInput): RecallResult {
    const now = input.now.toISOString()
    const candidates: ScoredMemory[] = [
      ...this.memories.listCore("global", null, "preference", 8).map((memory) => ({
        memory,
        group: "globalCore" as const,
        score: coreScore(memory, input.now, 1),
      })),
      ...this.memories.listCore("project", input.projectId, "rule", 12).map((memory) => ({
        memory,
        group: "projectCore" as const,
        score: coreScore(memory, input.now, 1.25),
      })),
    ]
    const ftsQuery = buildFtsQuery(input)
    if (ftsQuery) {
      candidates.push(
        ...this.memories.searchFts(ftsQuery, input.projectId, now, 32).map(({ memory, rank }) => ({
          memory,
          group: "dynamic" as const,
          score: dynamicScore(memory, rank, input.now),
        })),
      )
    }

    const selected: ScoredMemory[] = []
    const seen = new Set<string>()
    const groupCounts = { globalCore: 0, projectCore: 0, dynamic: 0 }
    const limits = { globalCore: 8, projectCore: 12, dynamic: 8 }
    const task = this.tasks.getActive(input.projectId)
    const budget = input.tokenBudget ?? 2_000

    for (const candidate of candidates.sort(
      (left, right) => priority(right) - priority(left) || right.score - left.score,
    )) {
      if (seen.has(candidate.memory.id) || groupCounts[candidate.group] >= limits[candidate.group]) continue
      const nextItems = [...selected, candidate].map(({ memory }) => toRecallItem(memory))
      if (estimateRecallTokens(nextItems) > budget) continue
      selected.push(candidate)
      seen.add(candidate.memory.id)
      groupCounts[candidate.group] += 1
    }

    const items = selected.map(({ memory }) => toRecallItem(memory))
    const includedTask = estimateRecallTokens(items, task) <= budget ? task : undefined
    return {
      items,
      task: includedTask,
      counts: { ...groupCounts, task: includedTask ? 1 : 0 },
      estimatedTokens: estimateRecallTokens(items, includedTask),
    }
  }

  markInjected(result: RecallResult): void {
    const ids = result.items.map((item) => item.id)
    if (ids.length === 0) return
    this.memories.markRecalled(ids, new Date().toISOString())
  }
}

function priority(candidate: ScoredMemory): number {
  if (candidate.group === "projectCore") return 3
  if (candidate.group === "dynamic" && candidate.memory.scope === "project") return 2
  return 1
}

function buildFtsQuery(input: RecallInput): string | undefined {
  const words = [input.query, ...input.recentTopics, ...input.currentFiles]
    .join(" ")
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{2,}/gu)
  const terms = [...new Set(words ?? [])].slice(0, 16)
  return terms.length > 0 ? terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ") : undefined
}

function coreScore(memory: MemoryRecord, now: Date, scopeWeight: number): number {
  return scopeWeight * memory.importance * memory.confidence * freshness(memory.updatedAt, now)
}

function dynamicScore(memory: MemoryRecord, rank: number, now: Date): number {
  const relevance = 1 / (1 + Math.abs(rank))
  const scopeWeight = memory.scope === "project" ? 1.25 : 1
  return relevance * scopeWeight * memory.importance * memory.confidence * freshness(memory.updatedAt, now)
}

function freshness(updatedAt: string, now: Date): number {
  const days = Math.max(0, (now.getTime() - new Date(updatedAt).getTime()) / 86_400_000)
  return Math.max(0.25, 1 / (1 + days / 30))
}

function toRecallItem(memory: MemoryRecord): RecallItem {
  return {
    id: memory.id,
    scope: memory.scope,
    kind: memory.kind,
    content: memory.content,
    updatedAt: memory.updatedAt,
  }
}
