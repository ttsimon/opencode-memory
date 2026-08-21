import type { MemoryCandidate, MemoryRecord } from "./domain/types"
import { inspectSensitive, type SensitiveReason } from "./security/filter"
import type { AuditRepository } from "./storage/audit-repository"
import type { MemoryDatabase } from "./storage/database"
import type { MemoryRepository } from "./storage/memory-repository"

export type RememberResult =
  | { readonly outcome: "created" | "updated"; readonly memory: MemoryRecord }
  | { readonly outcome: "rejected"; readonly reasons: readonly SensitiveReason[] }

export type ForgetResult =
  | { readonly outcome: "deleted"; readonly id: string }
  | { readonly outcome: "ambiguous"; readonly ids: readonly string[] }
  | { readonly outcome: "not_found" }

export class MemoryService {
  constructor(
    private readonly database: MemoryDatabase,
    private readonly memories: MemoryRepository,
    private readonly audit: AuditRepository,
  ) {}

  remember(candidate: MemoryCandidate): RememberResult {
    const safety = inspectSensitive(candidate.content)
    if (!safety.safe) {
      this.audit.rejected("remember", safety.reasons, candidate.sourceSessionId, candidate.sourceMessageId)
      return { outcome: "rejected", reasons: safety.reasons }
    }

    return this.database.raw.transaction(() => {
      const duplicate = this.memories.findDuplicate(candidate)
      if (duplicate) {
        const memory = this.memories.touch(duplicate, candidate)
        this.audit.updated(memory)
        return { outcome: "updated", memory } as const
      }
      const memory = this.memories.insert(candidate)
      this.audit.created(memory)
      return { outcome: "created", memory } as const
    })()
  }

  search(query: string, projectId?: string): MemoryRecord[] {
    return this.memories.search(query, projectId)
  }

  get(id: string): MemoryRecord | undefined {
    return this.memories.get(id)
  }

  forget(selector: { readonly id?: string; readonly query?: string; readonly projectId: string }): ForgetResult {
    let id = selector.id
    if (!id && selector.query) {
      const matches = this.memories.search(selector.query, selector.projectId)
      if (matches.length === 0) return { outcome: "not_found" }
      if (matches.length > 1) return { outcome: "ambiguous", ids: matches.map((memory) => memory.id) }
      id = matches[0]?.id
    }
    if (!id) return { outcome: "not_found" }

    return this.database.raw.transaction(() => {
      const current = this.memories.get(id)
      if (!current || current.status === "deleted") return { outcome: "not_found" } as const
      const deleted = this.memories.softDelete(id)
      if (!deleted) return { outcome: "not_found" } as const
      this.audit.deleted(deleted)
      return { outcome: "deleted", id } as const
    })()
  }

  history(id?: string) {
    return this.audit.list(id)
  }
}
