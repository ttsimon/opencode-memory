import type { TaskSnapshot, TaskSnapshotInput, TaskStatus } from "../domain/types"
import type { MemoryDatabase } from "./database"

interface TaskRow {
  id: string
  project_id: string
  goal: string
  status: TaskStatus
  completed_json: string
  in_progress_json: string
  files_json: string
  decisions_json: string
  blockers_json: string
  next_steps_json: string
  updated_at: string
  source_session_id: string
}

export class TaskRepository {
  constructor(private readonly database: MemoryDatabase) {}

  insert(input: TaskSnapshotInput): TaskSnapshot {
    const task: TaskSnapshot = { ...input, id: crypto.randomUUID(), updatedAt: new Date().toISOString() }
    this.database.raw
      .query(`
        INSERT INTO task_snapshots (
          id, project_id, goal, status, completed_json, in_progress_json, files_json,
          decisions_json, blockers_json, next_steps_json, updated_at, source_session_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.projectId,
        task.goal,
        task.status,
        JSON.stringify(task.completed),
        JSON.stringify(task.inProgress),
        JSON.stringify(task.files),
        JSON.stringify(task.decisions),
        JSON.stringify(task.blockers),
        JSON.stringify(task.nextSteps),
        task.updatedAt,
        task.sourceSessionId,
      )
    return task
  }

  get(id: string): TaskSnapshot | undefined {
    const row = this.database.raw.query<TaskRow, [string]>("SELECT * FROM task_snapshots WHERE id = ?").get(id)
    return row ? mapTask(row) : undefined
  }

  getActive(projectId: string): TaskSnapshot | undefined {
    const row = this.database.raw
      .query<TaskRow, [string]>("SELECT * FROM task_snapshots WHERE project_id = ? AND status = 'active' LIMIT 1")
      .get(projectId)
    return row ? mapTask(row) : undefined
  }

  archiveActive(projectId: string): TaskSnapshot | undefined {
    const current = this.getActive(projectId)
    if (!current) return undefined
    this.database.raw
      .query("UPDATE task_snapshots SET status = 'archived', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), current.id)
    return this.get(current.id)
  }

  list(projectId: string): TaskSnapshot[] {
    return this.database.raw
      .query<TaskRow, [string]>("SELECT * FROM task_snapshots WHERE project_id = ? ORDER BY rowid")
      .all(projectId)
      .map(mapTask)
  }
}

function mapTask(row: TaskRow): TaskSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    goal: row.goal,
    status: row.status,
    completed: JSON.parse(row.completed_json) as string[],
    inProgress: JSON.parse(row.in_progress_json) as string[],
    files: JSON.parse(row.files_json) as string[],
    decisions: JSON.parse(row.decisions_json) as string[],
    blockers: JSON.parse(row.blockers_json) as string[],
    nextSteps: JSON.parse(row.next_steps_json) as string[],
    updatedAt: row.updated_at,
    sourceSessionId: row.source_session_id,
  }
}
