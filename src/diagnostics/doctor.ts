import { stat } from "node:fs/promises"
import { join } from "node:path"
import type { DataPaths, ProjectScope } from "../domain/types"
import type { MemoryDatabase } from "../storage/database"

export interface DoctorCheck {
  readonly name: "database" | "fts" | "migration" | "project" | "permissions" | "projection"
  readonly status: "ok" | "warning" | "error"
  readonly message: string
}

export interface DoctorReport {
  readonly status: "ok" | "warning" | "error"
  readonly checks: readonly DoctorCheck[]
  readonly recommendations: readonly string[]
}

export class MemoryDoctor {
  constructor(
    private readonly database: MemoryDatabase,
    private readonly paths: DataPaths,
  ) {}

  async run(project: ProjectScope): Promise<DoctorReport> {
    const checks: DoctorCheck[] = []
    checks.push(
      check("database", this.database.integrityCheck() === "ok", `Integrity: ${this.database.integrityCheck()}`),
    )
    checks.push(check("fts", hasFts(this.database), "FTS table and triggers are present"))
    checks.push(
      check("migration", this.database.schemaVersion() > 0, `Schema version: ${this.database.schemaVersion()}`),
    )
    checks.push(check("project", /^[a-f0-9]{32}$/.test(project.projectId), `Project kind: ${project.kind}`))
    checks.push(await permissionCheck(this.paths.root))
    checks.push(
      await projectionCheck(
        this.database,
        project.projectId,
        join(this.paths.projects, project.projectId, "MEMORY.md"),
      ),
    )
    const recommendations: string[] = []
    if (checks.some((item) => item.name === "database" && item.status === "error")) {
      recommendations.push(`Restore from a backup under ${this.paths.backups}.`)
    }
    if (checks.some((item) => item.name === "projection" && item.status !== "ok")) {
      recommendations.push("Run a safe Markdown projection rebuild from SQLite.")
    }
    const status = checks.some((item) => item.status === "error")
      ? "error"
      : checks.some((item) => item.status === "warning")
        ? "warning"
        : "ok"
    return { status, checks, recommendations }
  }
}

function hasFts(database: MemoryDatabase): boolean {
  const names = database.tableNames()
  if (!names.includes("memory_fts")) return false
  const triggerCount = database.raw
    .query<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name IN ('memories_fts_insert', 'memories_fts_delete', 'memories_fts_update')
    `)
    .get()?.count
  return triggerCount === 3
}

function check(name: DoctorCheck["name"], valid: boolean, message: string): DoctorCheck {
  return { name, status: valid ? "ok" : "error", message }
}

async function permissionCheck(root: string): Promise<DoctorCheck> {
  try {
    const metadata = await stat(root)
    if (process.platform === "win32") {
      return { name: "permissions", status: "warning", message: "Windows ACL verification is not available." }
    }
    const secure = (metadata.mode & 0o077) === 0
    return {
      name: "permissions",
      status: secure ? "ok" : "warning",
      message: `Mode: ${(metadata.mode & 0o777).toString(8)}`,
    }
  } catch (error) {
    return { name: "permissions", status: "error", message: error instanceof Error ? error.message : String(error) }
  }
}

async function projectionCheck(database: MemoryDatabase, projectId: string, path: string): Promise<DoctorCheck> {
  const file = Bun.file(path)
  if (!(await file.exists())) return { name: "projection", status: "warning", message: "Projection is missing." }
  const text = await file.text()
  const rows = database.raw
    .query<{ content: string; status: string; importance: number }, [string]>(
      "SELECT content, status, importance FROM memories WHERE project_id = ?",
    )
    .all(projectId)
  const activeMissing = rows.some(
    (row) => row.status === "active" && row.importance >= 0.7 && !text.includes(row.content),
  )
  const inactivePresent = rows.some((row) => row.status !== "active" && text.includes(row.content))
  return text.includes("Generated from SQLite") && !activeMissing && !inactivePresent
    ? { name: "projection", status: "ok", message: "Projection marker is present." }
    : { name: "projection", status: "warning", message: "Projection should be rebuilt." }
}
