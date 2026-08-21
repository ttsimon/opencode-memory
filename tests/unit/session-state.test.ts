import { expect, test } from "bun:test"
import { SessionState } from "../../src/plugin/session-state"
import type { RecallResult } from "../../src/recall/engine"

function recall(content: string): RecallResult {
  return {
    items: [{ id: content, scope: "project", kind: "fact", content, updatedAt: "2026-08-21" }],
    task: undefined,
    counts: { globalCore: 0, projectCore: 0, dynamic: 1, task: 0 },
    estimatedTokens: 10,
  }
}

test("session state does not leak recall between sessions", () => {
  const state = new SessionState()
  state.setRecall("s1", recall("alpha"))
  expect(state.consumeRecall("s2")).toBeUndefined()
  expect(state.consumeRecall("s1")?.items[0]?.content).toBe("alpha")
  expect(state.consumeRecall("s1")).toBeUndefined()
})

test("tracks todos, current files and recent writes per session", () => {
  const state = new SessionState()
  state.setTodos("s1", [{ id: "1", content: "Implement", status: "pending", priority: "high" }])
  state.addCurrentFile("s1", "src/index.ts")
  state.addCurrentFile("s1", "src/index.ts")
  state.recordWrite("s1", { outcome: "created", id: "m1" })
  expect(state.get("s1")).toMatchObject({
    currentFiles: ["src/index.ts"],
    lastWrites: [{ outcome: "created", id: "m1" }],
  })
  expect(state.get("s2").currentFiles).toEqual([])
})

test("cleanup removes all session data", () => {
  const state = new SessionState()
  state.setRecall("s1", recall("alpha"))
  state.cleanup("s1")
  expect(state.get("s1").recall).toBeUndefined()
})
