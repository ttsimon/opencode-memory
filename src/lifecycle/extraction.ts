import type { MemoryCandidate, MemoryKind, MemoryScope } from "../domain/types"
import { inspectSensitive } from "../security/filter"

export interface ImmediateTurn {
  readonly text: string
  readonly projectId: string
  readonly sessionId: string
  readonly messageId: string
}

interface ExtractionRule {
  readonly pattern: RegExp
  readonly scope: MemoryScope | "infer"
  readonly kind: MemoryKind
  readonly confidence: number
}

const rules: readonly ExtractionRule[] = [
  { pattern: /\b(always|from now on)\b|以后|始终/i, scope: "infer", kind: "preference", confidence: 0.95 },
  { pattern: /\b(for this project|in this repo)\b|本项目|这个仓库/i, scope: "project", kind: "rule", confidence: 0.92 },
  {
    pattern: /\b(we decided|decision is|decided to)\b|已决定|确认采用|确定使用/i,
    scope: "project",
    kind: "decision",
    confidence: 0.93,
  },
  { pattern: /\bremember that\b|记住/i, scope: "project", kind: "fact", confidence: 0.9 },
]

export function extractImmediateCandidates(turn: ImmediateTurn): MemoryCandidate[] {
  const text = turn.text.trim()
  if (text.length < 8 || text.length > 1_000 || /\?$/.test(text) || /\b(maybe|perhaps|could|might)\b/i.test(text))
    return []
  if (!inspectSensitive(text).safe) return []
  const rule = rules.find((candidate) => candidate.pattern.test(text))
  if (!rule) return []

  const scope = inferScope(rule.scope, text)
  return [
    {
      scope,
      projectId: scope === "global" ? null : turn.projectId,
      kind: rule.kind,
      content: text,
      confidence: rule.confidence,
      importance: rule.kind === "decision" || rule.kind === "rule" ? 0.85 : 0.8,
      sourceSessionId: turn.sessionId,
      sourceMessageId: turn.messageId,
      ...(isCorrection(text) ? { conflictKey: correctionKey(rule.kind, text) } : {}),
    },
  ]
}

function inferScope(scope: MemoryScope | "infer", text: string): MemoryScope {
  if (scope !== "infer") return scope
  if (/\b(for this project|in this repo)\b|本项目|这个仓库/i.test(text)) return "project"
  return "global"
}

function isCorrection(text: string): boolean {
  return /\b(from now on|do not|don't|instead)\b|以后不要|改用/i.test(text)
}

function correctionKey(kind: MemoryKind, text: string): string {
  const topic = text
    .toLowerCase()
    .replace(/\b(from now on|do not|don't|instead|always|use)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return `${kind}:${new Bun.CryptoHasher("sha256").update(topic).digest("hex").slice(0, 16)}`
}
