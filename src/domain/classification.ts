import type { MemoryCandidate, MemoryKind, MemoryScope } from "./types"

export function classifyManualMemory(text: string, projectId: string): MemoryCandidate {
  const globalScope = /\b(always|across all projects|all projects|from now on)\b|以后|始终|所有项目/i.test(text)
  const scope: MemoryScope = globalScope ? "global" : "project"
  const kind = classifyKind(text, scope)
  const conflictKey = inferConflictKey(kind, text)
  return {
    scope,
    projectId: scope === "global" ? null : projectId,
    kind,
    content: text,
    confidence: 1,
    importance: scope === "global" ? 0.9 : 0.75,
    ...(conflictKey ? { conflictKey } : {}),
  }
}

export function inferConflictKey(kind: MemoryKind, text: string): string | undefined {
  if (/\b(npm|pnpm|yarn|bun)\b/i.test(text)) return `${kind}:package-manager`
  if (/\b(jest|vitest|bun test|test runner)\b/i.test(text)) return `${kind}:test-runner`
  if (/\b(sqlite|postgres|mysql|database)\b/i.test(text)) return `${kind}:database`
  return undefined
}

function classifyKind(text: string, scope: MemoryScope): MemoryKind {
  if (/\b(we decided|decision is|decided to|已决定|确认采用|确定使用)\b/i.test(text)) return "decision"
  if (/\b(for this project|in this repo|must|always use|across all projects)\b|本项目|这个仓库|必须/i.test(text)) {
    return "rule"
  }
  if (scope === "global" && /\b(answer|reply|communicat|prefer|喜欢|回复|回答)\b/i.test(text)) return "preference"
  return "fact"
}
