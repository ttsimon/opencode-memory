import { Database } from "bun:sqlite"
import { chmod, copyFile, readdir, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import type { DataPaths } from "../domain/types"
import { ensureDataPaths } from "../paths"
import { migrations as defaultMigrations } from "./migrations"

export interface Migration {
  readonly version: number
  up(database: Database): void
}

export interface MemoryDatabase {
  readonly raw: Database
  schemaVersion(): number
  tableNames(): string[]
  integrityCheck(): string
  close(): void
}

interface OpenDatabaseOptions {
  readonly migrations?: readonly Migration[]
}

export async function openDatabase(paths: DataPaths, options: OpenDatabaseOptions = {}): Promise<MemoryDatabase> {
  await ensureDataPaths(paths, process.platform)
  const requestedMigrations = options.migrations ?? defaultMigrations
  const highestSupportedVersion = Math.max(0, ...requestedMigrations.map((migration) => migration.version))
  const existingSize = await stat(paths.database)
    .then((metadata) => metadata.size)
    .catch(() => 0)
  if (existingSize > 0) {
    const probe = new Database(paths.database, { readonly: true, strict: true })
    const existingVersion = readUserVersion(probe)
    probe.close()
    if (existingVersion > highestSupportedVersion) {
      throw new Error(
        `Database schema version ${existingVersion} is newer than supported version ${highestSupportedVersion}`,
      )
    }
    if (existingVersion === 0) {
      const checkpoint = new Database(paths.database, { strict: true })
      assertCheckpointComplete(checkpoint.query<CheckpointResult, []>("PRAGMA wal_checkpoint(TRUNCATE)").get())
      checkpoint.close()
      await copyBackupFile(paths, 0)
    }
  }
  const database = new Database(paths.database, { create: true, strict: true })
  if (process.platform !== "win32") await chmod(paths.database, 0o600)
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA journal_mode = WAL")
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  try {
    await applyMigrations(database, paths, requestedMigrations)
  } catch (error) {
    database.close()
    throw error
  }

  return {
    raw: database,
    schemaVersion: () => readUserVersion(database),
    tableNames: () =>
      database
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((row) => row.name),
    integrityCheck: () =>
      database.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check ?? "unknown",
    close: () => database.close(),
  }
}

async function applyMigrations(database: Database, paths: DataPaths, requested: readonly Migration[]): Promise<void> {
  const migrations = [...requested].sort((left, right) => left.version - right.version)
  assertMigrationSequence(migrations)
  const currentVersion = readUserVersion(database)
  const pending = migrations.filter((migration) => migration.version > currentVersion)
  if (pending.length === 0) return

  if (currentVersion > 0) await createMigrationBackup(database, paths, currentVersion)

  for (const migration of pending) {
    try {
      database.transaction(() => {
        migration.up(database)
        database
          .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, new Date().toISOString())
        database.exec(`PRAGMA user_version = ${migration.version}`)
      })()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Migration ${migration.version} failed: ${message}`, { cause: error })
    }
  }
}

function assertMigrationSequence(migrations: readonly Migration[]): void {
  const versions = new Set<number>()
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid migration version: ${migration.version}`)
    }
    if (versions.has(migration.version)) throw new Error(`Duplicate migration version: ${migration.version}`)
    versions.add(migration.version)
  }
}

function readUserVersion(database: Database): number {
  return database.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
}

async function createMigrationBackup(database: Database, paths: DataPaths, version: number): Promise<void> {
  assertCheckpointComplete(database.query<CheckpointResult, []>("PRAGMA wal_checkpoint(TRUNCATE)").get())
  await copyBackupFile(paths, version)
}

interface CheckpointResult {
  busy: number
  log: number
  checkpointed: number
}

export function assertCheckpointComplete(result: CheckpointResult | null): void {
  if (result?.busy !== 0) throw new Error("Cannot create a complete migration backup while the WAL is busy")
}

async function copyBackupFile(paths: DataPaths, version: number): Promise<void> {
  const timestamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  await copyFile(paths.database, join(paths.backups, `memory-v${version}-${timestamp}.db`))
  if (process.platform !== "win32") await chmod(join(paths.backups, `memory-v${version}-${timestamp}.db`), 0o600)
  const backups = sortBackupFilesNewestFirst(
    (await readdir(paths.backups)).filter((file) => /^memory-v\d+-\d+-[a-f0-9-]+\.db$/i.test(file)),
  )
  await Promise.all(backups.slice(3).map((file) => unlink(join(paths.backups, file))))
}

export function sortBackupFilesNewestFirst(files: readonly string[]): string[] {
  return [...files].sort((left, right) => backupTimestamp(right) - backupTimestamp(left))
}

function backupTimestamp(file: string): number {
  return Number(file.match(/^memory-v\d+-(\d+)-/)?.[1] ?? 0)
}
