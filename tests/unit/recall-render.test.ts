import { expect, test } from "bun:test"
import type { RecallResult } from "../../src/recall/engine"
import { renderRecall } from "../../src/recall/render"

test("renders the exact memory wrapper and precedence warning", () => {
  const result: RecallResult = {
    items: [
      {
        id: "m1",
        scope: "project",
        kind: "decision",
        content: "Use bun:sqlite",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ],
    task: undefined,
    counts: { globalCore: 0, projectCore: 0, dynamic: 1, task: 0 },
    estimatedTokens: 50,
  }
  const rendered = renderRecall(result)
  expect(rendered).toContain("<opencode-memory>")
  expect(rendered).toContain("当前明确指令、项目文件和代码事实优先")
  expect(rendered).toContain("[项目/决策/2026-08-20] Use bun:sqlite")
  expect(rendered).toContain("</opencode-memory>")
})

test("returns undefined for an empty recall", () => {
  expect(
    renderRecall({
      items: [],
      task: undefined,
      counts: { globalCore: 0, projectCore: 0, dynamic: 0, task: 0 },
      estimatedTokens: 0,
    }),
  ).toBeUndefined()
})

test("renders an active task snapshot", () => {
  const rendered = renderRecall({
    items: [],
    task: {
      id: "t1",
      projectId: "p1",
      goal: "Implement recall",
      status: "active",
      completed: [],
      inProgress: [],
      files: [],
      decisions: [],
      blockers: [],
      nextSteps: ["Run tests"],
      updatedAt: "2026-08-21T00:00:00.000Z",
      sourceSessionId: "s1",
    },
    counts: { globalCore: 0, projectCore: 0, dynamic: 0, task: 1 },
    estimatedTokens: 20,
  })
  expect(rendered).toContain("Goal: Implement recall; Next: Run tests")
})
