import { expect, test } from "bun:test"
import { extractImmediateCandidates } from "../../src/lifecycle/extraction"

function turn(text: string) {
  return { text, projectId: "project-1", sessionId: "s1", messageId: "m1" }
}

test.each([
  ["Always answer me in Chinese", "global", null, "preference"],
  ["For this project, use bun for all scripts", "project", "project-1", "rule"],
  ["We decided to keep SQLite as the source of truth", "project", "project-1", "decision"],
] as const)("extracts %s", (text, scope, projectId, kind) => {
  expect(extractImmediateCandidates(turn(text))).toMatchObject([
    { scope, projectId, kind, confidence: expect.any(Number), sourceSessionId: "s1", sourceMessageId: "m1" },
  ])
})

test("defaults explicit remember wording to a project fact", () => {
  expect(extractImmediateCandidates(turn("Remember that tests use Bun"))).toMatchObject([
    { scope: "project", projectId: "project-1", kind: "fact" },
  ])
})

test.each(["Maybe we could use Redis someday", "Should we use Postgres?", "password=hunter2", "This is a short note"])(
  "does not extract %s",
  (text) => {
    expect(extractImmediateCandidates(turn(text))).toEqual([])
  },
)

test("adds a stable conflict key for persistent corrections", () => {
  expect(extractImmediateCandidates(turn("From now on, do not use npm; use bun instead"))[0]).toMatchObject({
    kind: "preference",
    conflictKey: expect.any(String),
  })
})

test("project wording classifies always statements as project rules", () => {
  expect(extractImmediateCandidates(turn("Always use bun for this project"))[0]).toMatchObject({
    scope: "project",
    kind: "rule",
  })
})
