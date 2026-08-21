import type { MemoryCandidate, MemoryRecord, MemoryStatus } from "../domain/types"
import type { MemoryDatabase } from "./database"

interface MemoryRow {
  id: string
  scope: "global" | "project"
  project_id: string | null
  kind: MemoryRecord["kind"]
  content: string
  normalized_content: string
  status: MemoryStatus
  confidence: number
  importance: number
  source_session_id: string | null
  source_message_id: string | null
  created_at: string
  updated_at: string
  last_recalled_at: string | null
  recall_count: number
  expires_at: string | null
  supersedes_id: string | null
}

interface RankedMemoryRow extends MemoryRow {
  rank: number
}

export class MemoryRepository {
  constructor(private readonly database: MemoryDatabase) {}

  insert(candidate: MemoryCandidate): MemoryRecord {
    const now = new Date().toISOString()
    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      scope: candidate.scope,
      projectId: candidate.projectId,
      kind: candidate.kind,
      content: candidate.content.trim(),
      normalizedContent: normalizeMemory(candidate.content),
      status: "active",
      confidence: candidate.confidence,
      importance: candidate.importance,
      sourceSessionId: candidate.sourceSessionId ?? null,
      sourceMessageId: candidate.sourceMessageId ?? null,
      createdAt: now,
      updatedAt: now,
      lastRecalledAt: null,
      recallCount: 0,
      expiresAt: candidate.expiresAt ?? null,
      supersedesId: null,
    }
    this.database.raw
      .query(`
        INSERT INTO memories (
          id, scope, project_id, kind, content, normalized_content, status, confidence, importance,
          source_session_id, source_message_id, created_at, updated_at, expires_at, conflict_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.scope,
        record.projectId,
        record.kind,
        record.content,
        record.normalizedContent,
        record.status,
        record.confidence,
        record.importance,
        record.sourceSessionId,
        record.sourceMessageId,
        record.createdAt,
        record.updatedAt,
        record.expiresAt,
        candidate.conflictKey ?? null,
      )
    return record
  }

  findDuplicate(candidate: MemoryCandidate): MemoryRecord | undefined {
    if (candidate.sourceSessionId && candidate.sourceMessageId) {
      const bySource = this.database.raw
        .query<MemoryRow, [string, string, string, string]>(`
          SELECT * FROM memories
          WHERE source_session_id = ? AND source_message_id = ? AND kind = ? AND normalized_content = ?
          LIMIT 1
        `)
        .get(candidate.sourceSessionId, candidate.sourceMessageId, candidate.kind, normalizeMemory(candidate.content))
      if (bySource) return mapMemory(bySource)
    }
    const byContent = this.database.raw
      .query<MemoryRow, [string, string | null, string, string]>(`
        SELECT * FROM memories
        WHERE scope = ? AND project_id IS ? AND kind = ? AND normalized_content = ? AND status = 'active'
        LIMIT 1
      `)
      .get(candidate.scope, candidate.projectId, candidate.kind, normalizeMemory(candidate.content))
    return byContent ? mapMemory(byContent) : undefined
  }

  touch(record: MemoryRecord, candidate: MemoryCandidate): MemoryRecord {
    const updatedAt = new Date().toISOString()
    this.database.raw
      .query("UPDATE memories SET confidence = ?, importance = ?, updated_at = ? WHERE id = ?")
      .run(
        Math.max(record.confidence, candidate.confidence),
        Math.max(record.importance, candidate.importance),
        updatedAt,
        record.id,
      )
    return this.get(record.id) ?? record
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.database.raw.query<MemoryRow, [string]>("SELECT * FROM memories WHERE id = ?").get(id)
    return row ? mapMemory(row) : undefined
  }

  count(): number {
    return this.database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM memories").get()?.count ?? 0
  }

  listByStatus(status: MemoryStatus): MemoryRecord[] {
    return this.database.raw
      .query<MemoryRow, [MemoryStatus]>("SELECT * FROM memories WHERE status = ? ORDER BY created_at")
      .all(status)
      .map(mapMemory)
  }

  search(query: string, projectId?: string): MemoryRecord[] {
    const pattern = `%${query.toLowerCase()}%`
    return this.database.raw
      .query<MemoryRow, [string, string | null]>(`
        SELECT * FROM memories
        WHERE status = 'active' AND lower(content) LIKE ?
          AND (scope = 'global' OR (scope = 'project' AND project_id IS ?))
        ORDER BY importance DESC, updated_at DESC
      `)
      .all(pattern, projectId ?? null)
      .map(mapMemory)
  }

  listCore(
    scope: "global" | "project",
    projectId: string | null,
    kind: "preference" | "rule",
    limit: number,
  ): MemoryRecord[] {
    return this.database.raw
      .query<MemoryRow, [string, string | null, string, number]>(`
        SELECT * FROM memories
        WHERE scope = ? AND project_id IS ? AND kind = ? AND status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `)
      .all(scope, projectId, kind, limit)
      .map(mapMemory)
  }

  searchFts(
    ftsQuery: string,
    projectId: string,
    now: string,
    limit: number,
  ): Array<{ memory: MemoryRecord; rank: number }> {
    return this.database.raw
      .query<RankedMemoryRow, [string, string, string, number]>(`
        SELECT memories.*, bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memories ON memories.rowid = memory_fts.rowid
        WHERE memory_fts MATCH ?
          AND memories.status = 'active'
          AND (memories.expires_at IS NULL OR memories.expires_at > ?)
          AND (memories.scope = 'global' OR memories.project_id = ?)
        ORDER BY rank ASC
        LIMIT ?
      `)
      .all(ftsQuery, now, projectId, limit)
      .map((row) => ({ memory: mapMemory(row), rank: row.rank }))
  }

  markRecalled(ids: readonly string[], recalledAt: string): void {
    const update = this.database.raw.query(
      "UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?",
    )
    const transaction = this.database.raw.transaction((memoryIds: readonly string[]) => {
      for (const id of memoryIds) update.run(recalledAt, id)
    })
    transaction(ids)
  }

  softDelete(id: string): MemoryRecord | undefined {
    this.database.raw
      .query("UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ? AND status != 'deleted'")
      .run(new Date().toISOString(), id)
    return this.get(id)
  }
}

export function normalizeMemory(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase()
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    kind: row.kind,
    content: row.content,
    normalizedContent: row.normalized_content,
    status: row.status,
    confidence: row.confidence,
    importance: row.importance,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRecalledAt: row.last_recalled_at,
    recallCount: row.recall_count,
    expiresAt: row.expires_at,
    supersedesId: row.supersedes_id,
  }
}
