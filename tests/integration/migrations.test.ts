import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { readdir, rm } from "node:fs/promises"
import { type Migration, openDatabase, sortBackupFilesNewestFirst } from "../../src/storage/database"
import { createDatabaseFixture } from "../helpers/database"

const versionOne: Migration = {
  version: 1,
  up(database) {
    database.exec("CREATE TABLE marker (value TEXT NOT NULL)")
  },
}

test("migration failure rolls back and keeps a restorable backup", async () => {
  const fixture = await createDatabaseFixture([versionOne])
  fixture.database.close()
  const failing: Migration = {
    version: 2,
    up(database) {
      database.exec("CREATE TABLE partial (value TEXT)")
      throw new Error("migration exploded")
    },
  }

  try {
    await expect(openDatabase(fixture.paths, { migrations: [versionOne, failing] })).rejects.toThrow(
      "Migration 2 failed: migration exploded",
    )
    const backups = await readdir(fixture.paths.backups)
    expect(backups).toHaveLength(1)
    const backup = new Database(`${fixture.paths.backups}/${backups[0]}`, { readonly: true, strict: true })
    try {
      expect(backup.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(backup.query("PRAGMA user_version").get()).toEqual({ user_version: 1 })
      expect(backup.query("SELECT name FROM sqlite_master WHERE name = 'partial'").get()).toBeNull()
    } finally {
      backup.close()
    }
  } finally {
    await fixture.close()
  }
})

test("retains only the newest three migration backups", async () => {
  const fixture = await createDatabaseFixture([versionOne])
  fixture.database.close()
  try {
    for (let version = 2; version <= 5; version += 1) {
      const migrations: Migration[] = [versionOne]
      for (let next = 2; next <= version; next += 1) {
        migrations.push({
          version: next,
          up(database) {
            database.exec(`CREATE TABLE marker_${next} (value TEXT)`)
          },
        })
      }
      const database = await openDatabase(fixture.paths, { migrations })
      database.close()
      await Bun.sleep(2)
    }
    expect((await readdir(fixture.paths.backups)).length).toBe(3)
  } finally {
    await fixture.close()
  }
})

test("backs up an existing version-zero database before framework metadata is added", async () => {
  const fixture = await createDatabaseFixture([versionOne])
  fixture.database.close()
  await rm(fixture.paths.database, { force: true })
  await rm(`${fixture.paths.database}-wal`, { force: true })
  await rm(`${fixture.paths.database}-shm`, { force: true })
  const raw = new Database(fixture.paths.database, { create: true })
  raw.exec("PRAGMA user_version = 0; CREATE TABLE legacy (value TEXT); INSERT INTO legacy VALUES ('keep')")
  raw.close()
  try {
    const database = await openDatabase(fixture.paths, { migrations: [versionOne] })
    database.close()
    const backups = await readdir(fixture.paths.backups)
    const backup = new Database(`${fixture.paths.backups}/${backups[0]}`, { readonly: true })
    expect(backup.query("SELECT value FROM legacy").get()).toEqual({ value: "keep" })
    expect(backup.query("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeNull()
    backup.close()
  } finally {
    await fixture.close()
  }
})

test("sorts migration backups by timestamp instead of version text", () => {
  expect(sortBackupFilesNewestFirst(["memory-v9-200-a.db", "memory-v10-300-b.db", "memory-v11-100-c.db"])).toEqual([
    "memory-v10-300-b.db",
    "memory-v9-200-a.db",
    "memory-v11-100-c.db",
  ])
})
