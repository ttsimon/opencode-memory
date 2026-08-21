export type MemoryScope = "global" | "project"
export type MemoryKind = "preference" | "rule" | "fact" | "decision" | "insight" | "task"
export type MemoryStatus = "active" | "superseded" | "archived" | "deleted"

export interface MemoryRecord {
  readonly id: string
  readonly scope: MemoryScope
  readonly projectId: string | null
  readonly kind: MemoryKind
  readonly content: string
  readonly normalizedContent: string
  readonly status: MemoryStatus
  readonly confidence: number
  readonly importance: number
  readonly sourceSessionId: string | null
  readonly sourceMessageId: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastRecalledAt: string | null
  readonly recallCount: number
  readonly expiresAt: string | null
  readonly supersedesId: string | null
}

export interface MemoryCandidate {
  readonly scope: MemoryScope
  readonly projectId: string | null
  readonly kind: MemoryKind
  readonly content: string
  readonly confidence: number
  readonly importance: number
  readonly sourceSessionId?: string
  readonly sourceMessageId?: string
  readonly expiresAt?: string
  readonly conflictKey?: string
}

export interface ProjectScope {
  readonly projectId: string
  readonly root: string
  readonly identity: string
  readonly kind: "git" | "path"
}

export interface DataPaths {
  readonly root: string
  readonly database: string
  readonly backups: string
  readonly global: string
  readonly globalMemory: string
  readonly globalTopics: string
  readonly projects: string
}

export type TaskStatus = "active" | "completed" | "archived"

export interface TaskSnapshot {
  readonly id: string
  readonly projectId: string
  readonly goal: string
  readonly status: TaskStatus
  readonly completed: readonly string[]
  readonly inProgress: readonly string[]
  readonly files: readonly string[]
  readonly decisions: readonly string[]
  readonly blockers: readonly string[]
  readonly nextSteps: readonly string[]
  readonly updatedAt: string
  readonly sourceSessionId: string
}

export interface TaskSnapshotInput extends Omit<TaskSnapshot, "id" | "updatedAt"> {}

export interface AuditEvent {
  readonly id: string
  readonly entityType: "memory" | "task" | "filter"
  readonly entityId: string | null
  readonly operation: string
  readonly sourceSessionId: string | null
  readonly sourceMessageId: string | null
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly summary: string
  readonly reasons: readonly string[]
  readonly createdAt: string
}
