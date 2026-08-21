import type { AuditEvent, MemoryRecord, TaskSnapshot } from "../domain/types"
import type { SensitiveReason } from "../security/filter"
import type { MemoryDatabase } from "./database"

interface AuditRow {
  id: string
  entity_type: AuditEvent["entityType"]
  entity_id: string | null
  operation: string
  source_session_id: string | null
  source_message_id: string | null
  from_status: string | null
  to_status: string | null
  summary: string
  reasons_json: string | null
  created_at: string
}

export class AuditRepository {
  constructor(private readonly database: MemoryDatabase) {}

  created(memory: MemoryRecord): void {
    this.insert({
      entityType: "memory",
      entityId: memory.id,
      operation: "create",
      sourceSessionId: memory.sourceSessionId,
      sourceMessageId: memory.sourceMessageId,
      fromStatus: null,
      toStatus: memory.status,
      summary: `Created ${memory.scope} ${memory.kind}`,
      reasons: [],
    })
  }

  updated(memory: MemoryRecord): void {
    this.insert({
      entityType: "memory",
      entityId: memory.id,
      operation: "update",
      sourceSessionId: memory.sourceSessionId,
      sourceMessageId: memory.sourceMessageId,
      fromStatus: memory.status,
      toStatus: memory.status,
      summary: `Updated ${memory.scope} ${memory.kind}`,
      reasons: [],
    })
  }

  deleted(memory: MemoryRecord): void {
    this.insert({
      entityType: "memory",
      entityId: memory.id,
      operation: "delete",
      sourceSessionId: memory.sourceSessionId,
      sourceMessageId: memory.sourceMessageId,
      fromStatus: "active",
      toStatus: "deleted",
      summary: `Soft-deleted ${memory.scope} ${memory.kind}`,
      reasons: [],
    })
  }

  rejected(
    operation: string,
    reasons: readonly SensitiveReason[],
    sourceSessionId?: string,
    sourceMessageId?: string,
  ): void {
    this.insert({
      entityType: "filter",
      entityId: null,
      operation,
      sourceSessionId: sourceSessionId ?? null,
      sourceMessageId: sourceMessageId ?? null,
      fromStatus: null,
      toStatus: null,
      summary: "Rejected sensitive content",
      reasons,
    })
  }

  task(operation: string, task: TaskSnapshot, fromStatus: string | null): void {
    this.insert({
      entityType: "task",
      entityId: task.id,
      operation,
      sourceSessionId: task.sourceSessionId,
      sourceMessageId: null,
      fromStatus,
      toStatus: task.status,
      summary: `Task ${operation}`,
      reasons: [],
    })
  }

  list(entityId?: string): AuditEvent[] {
    const rows = entityId
      ? this.database.raw
          .query<AuditRow, [string]>("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY created_at, rowid")
          .all(entityId)
      : this.database.raw.query<AuditRow, []>("SELECT * FROM audit_events ORDER BY created_at, rowid").all()
    return rows.map(mapAudit)
  }

  private insert(event: Omit<AuditEvent, "id" | "createdAt">): void {
    this.database.raw
      .query(`
        INSERT INTO audit_events (
          id, entity_type, entity_id, operation, source_session_id, source_message_id,
          from_status, to_status, summary, reasons_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        crypto.randomUUID(),
        event.entityType,
        event.entityId,
        event.operation,
        event.sourceSessionId,
        event.sourceMessageId,
        event.fromStatus,
        event.toStatus,
        event.summary,
        JSON.stringify(event.reasons),
        new Date().toISOString(),
      )
  }
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    summary: row.summary,
    reasons: JSON.parse(row.reasons_json ?? "[]") as string[],
    createdAt: row.created_at,
  }
}
