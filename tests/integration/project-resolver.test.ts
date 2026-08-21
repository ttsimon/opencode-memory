import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveProject } from "../../src/project/resolver"
import { createGitRepository, createGitWorktreeFixture } from "../helpers/git"

test("root, child and linked worktree share one project id", async () => {
  const fixture = await createGitWorktreeFixture()
  try {
    const scopes = await Promise.all([
      resolveProject({ directory: fixture.root, worktree: fixture.root }),
      resolveProject({ directory: fixture.child, worktree: fixture.root }),
      resolveProject({ directory: fixture.linked, worktree: fixture.linked }),
    ])

    expect(new Set(scopes.map((scope) => scope.projectId)).size).toBe(1)
    expect(scopes[0]?.projectId).toMatch(/^[a-f0-9]{32}$/)
    expect(scopes[0]?.projectId).not.toContain(fixture.root)
    expect(scopes.every((scope) => scope.kind === "git")).toBe(true)
  } finally {
    await fixture.cleanup()
  }
})

test("different repositories have different project ids", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-memory-repositories-"))
  try {
    const first = await createGitRepository(temporaryRoot, "first")
    const second = await createGitRepository(temporaryRoot, "second")
    const firstScope = await resolveProject({ directory: first, worktree: first })
    const secondScope = await resolveProject({ directory: second, worktree: second })
    expect(firstScope.projectId).not.toBe(secondScope.projectId)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("non-Git directories use a stable canonical path identity", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-memory-nongit-"))
  const child = join(temporaryRoot, "child")
  await mkdir(child)
  try {
    const first = await resolveProject({ directory: child, worktree: child })
    const second = await resolveProject({ directory: child, worktree: child })
    expect(first).toEqual(second)
    expect(first.kind).toBe("path")
    expect(first.projectId).toMatch(/^[a-f0-9]{32}$/)
    expect(first.projectId).not.toContain(child)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
