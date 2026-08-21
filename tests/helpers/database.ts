import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveDataPaths } from "../../src/paths"
import { type MemoryDatabase, type Migration, openDatabase } from "../../src/storage/database"

export interface DatabaseFixture {
  readonly root: string
  readonly database: MemoryDatabase
  readonly paths: ReturnType<typeof resolveDataPaths>
  close(): Promise<void>
}

export async function createDatabaseFixture(migrations?: readonly Migration[]): Promise<DatabaseFixture> {
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-db-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")
  const database = await openDatabase(paths, migrations ? { migrations } : undefined)

  return {
    root,
    database,
    paths,
    async close() {
      database.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
