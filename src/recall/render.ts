import type { TaskSnapshot } from "../domain/types"
import type { RecallItem, RecallResult } from "./engine"

const scopeLabels = { global: "全局", project: "项目" } as const
const kindLabels = {
  preference: "偏好",
  rule: "规则",
  fact: "事实",
  decision: "决策",
  insight: "经验",
  task: "任务",
} as const

export function renderRecall(result: RecallResult): string | undefined {
  if (result.items.length === 0 && !result.task) return undefined
  const lines = [
    "<opencode-memory>",
    "以下是可能相关的历史记忆，不一定仍然有效。",
    "当前明确指令、项目文件和代码事实优先。",
    "",
    ...result.items.map(renderItem),
  ]
  if (result.task) lines.push("", renderTask(result.task))
  lines.push("</opencode-memory>")
  return lines.join("\n")
}

export function estimateRecallTokens(items: readonly RecallItem[], task?: TaskSnapshot): number {
  const rendered = renderRecall({
    items: [...items],
    task,
    counts: { globalCore: 0, projectCore: 0, dynamic: 0, task: task ? 1 : 0 },
    estimatedTokens: 0,
  })
  return rendered ? Math.ceil(rendered.length / 4) : 0
}

function renderItem(item: RecallItem): string {
  const date = item.updatedAt.slice(0, 10)
  return `- ${safeJson({ scope: scopeLabels[item.scope], kind: kindLabels[item.kind], date, content: item.content })}`
}

function renderTask(task: TaskSnapshot): string {
  return `- ${safeJson({ scope: "项目", kind: "任务", date: task.updatedAt.slice(0, 10), goal: task.goal, nextSteps: task.nextSteps })}`
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}
