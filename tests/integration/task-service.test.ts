import { expect, test } from "bun:test"
import { AuditRepository } from "../../src/storage/audit-repository"
import { TaskRepository } from "../../src/storage/task-repository"
import { TaskService } from "../../src/task-service"
import { createDatabaseFixture } from "../helpers/database"

function snapshot(goal: string) {
  return {
    projectId: "project-1",
    goal,
    status: "active" as const,
    completed: [],
    inProgress: [goal],
    files: [],
    decisions: [],
    blockers: [],
    nextSteps: ["Continue"],
    sourceSessionId: "s1",
  }
}

test("a new unrelated task archives the previous active task", async () => {
  const fixture = await createDatabaseFixture()
  const repository = new TaskRepository(fixture.database)
  const service = new TaskService(fixture.database, repository, new AuditRepository(fixture.database))
  try {
    service.replace(snapshot("Add search"))
    service.replace(snapshot("Fix login"))
    expect(repository.list("project-1").map((item) => item.status)).toEqual(["archived", "active"])
    expect(service.getActive("project-1")?.goal).toBe("Fix login")
  } finally {
    await fixture.close()
  }
})

test("completed tasks are archived and not active", async () => {
  const fixture = await createDatabaseFixture()
  const repository = new TaskRepository(fixture.database)
  const service = new TaskService(fixture.database, repository, new AuditRepository(fixture.database))
  try {
    const active = service.replace(snapshot("Add search"))
    service.archive("project-1", "completed")
    expect(service.getActive("project-1")).toBeUndefined()
    expect(repository.get(active.id)?.status).toBe("archived")
  } finally {
    await fixture.close()
  }
})
