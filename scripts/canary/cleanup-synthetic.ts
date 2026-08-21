import { Database } from "bun:sqlite"

export function cleanupSyntheticMemory(databasePath: string, prefix: string): number {
  if (!prefix.startsWith("OCM-CANARY-")) throw new Error("Synthetic cleanup requires an OCM-CANARY prefix")
  const database = new Database(databasePath, { strict: true })
  try {
    return database.query("DELETE FROM memories WHERE content LIKE ?").run(`${prefix}%`).changes
  } finally {
    database.close()
  }
}
