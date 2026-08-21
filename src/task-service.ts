import type { TaskSnapshot, TaskSnapshotInput } from "./domain/types"
import type { AuditRepository } from "./storage/audit-repository"
import type { MemoryDatabase } from "./storage/database"
import type { TaskRepository } from "./storage/task-repository"

export class TaskService {
  constructor(
    private readonly database: MemoryDatabase,
    private readonly tasks: TaskRepository,
    private readonly audit: AuditRepository,
  ) {}

  getActive(projectId: string): TaskSnapshot | undefined {
    return this.tasks.getActive(projectId)
  }

  replace(input: TaskSnapshotInput): TaskSnapshot {
    return this.database.raw.transaction(() => {
      const current = this.tasks.getActive(input.projectId)
      if (current && current.goal !== input.goal) {
        const archived = this.tasks.archiveActive(input.projectId)
        if (archived) this.audit.task("archive", archived, "active")
      } else if (current) {
        const archived = this.tasks.archiveActive(input.projectId)
        if (archived) this.audit.task("replace", archived, "active")
      }
      const task = this.tasks.insert(input)
      this.audit.task("create", task, null)
      return task
    })()
  }

  archive(projectId: string, reason: string): TaskSnapshot | undefined {
    return this.database.raw.transaction(() => {
      const archived = this.tasks.archiveActive(projectId)
      if (archived) this.audit.task(`archive:${reason}`, archived, "active")
      return archived
    })()
  }
}
