import { expect, test } from "bun:test"
import { classifyManualMemory } from "../../src/domain/classification"

test.each([
  ["Always answer me in Chinese", "global", null, "preference"],
  ["Across all projects, use concise commit messages", "global", null, "rule"],
  ["For this project, use bun for all scripts", "project", "project-1", "rule"],
  ["We decided to keep SQLite as the source of truth", "project", "project-1", "decision"],
  ["Tests run with bun test", "project", "project-1", "fact"],
] as const)("classifies %s", (text, scope, expectedProjectId, kind) => {
  expect(classifyManualMemory(text, "project-1")).toMatchObject({
    scope,
    projectId: expectedProjectId,
    kind,
    content: text,
    confidence: 1,
  })
})

test("defaults uncertain scope to a project fact", () => {
  expect(classifyManualMemory("Remember the staging port is 4400", "project-1")).toMatchObject({
    scope: "project",
    projectId: "project-1",
    kind: "fact",
  })
})

test("package-manager corrections share a stable conflict key", () => {
  expect(classifyManualMemory("For this project, use npm", "p1").conflictKey).toBe(
    classifyManualMemory("For this project, use bun", "p1").conflictKey,
  )
})

test("explicit project wording overrides global persistence wording", () => {
  expect(classifyManualMemory("Always use bun for this project", "p1")).toMatchObject({
    scope: "project",
    projectId: "p1",
  })
})
