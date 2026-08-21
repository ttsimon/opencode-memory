import { expect, test } from "bun:test"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureDataPaths, resolveDataPaths } from "../../src/paths"

test("uses LOCALAPPDATA and never the repository on Windows", () => {
  const paths = resolveDataPaths({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32")

  expect(paths.root).toBe("C:\\Users\\me\\AppData\\Local\\opencode-memory")
  expect(paths.database).toBe(`${paths.root}\\memory.db`)
  expect(paths.backups).toBe(`${paths.root}\\backups`)
})

test("uses Application Support on macOS", () => {
  const paths = resolveDataPaths({ HOME: "/Users/me" }, "darwin")

  expect(paths.root).toBe("/Users/me/Library/Application Support/opencode-memory")
})

test("uses XDG_DATA_HOME or the Linux fallback", () => {
  expect(resolveDataPaths({ XDG_DATA_HOME: "/data", HOME: "/home/me" }, "linux").root).toBe("/data/opencode-memory")
  expect(resolveDataPaths({ HOME: "/home/me" }, "linux").root).toBe("/home/me/.local/share/opencode-memory")
})

test("creates data directories with owner-only modes on POSIX", async () => {
  if (process.platform === "win32") return
  const root = await mkdtemp(join(tmpdir(), "opencode-memory-paths-"))
  const paths = resolveDataPaths({ XDG_DATA_HOME: root, HOME: root }, "linux")

  try {
    await ensureDataPaths(paths, "linux")
    for (const directory of [paths.root, paths.backups, paths.global, paths.globalTopics, paths.projects]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
    }
  } finally {
    await chmod(root, 0o700).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test("requires an operating-system home directory", () => {
  expect(() => resolveDataPaths({}, "linux")).toThrow("HOME")
  expect(() => resolveDataPaths({}, "win32")).toThrow("LOCALAPPDATA")
})
