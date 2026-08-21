import { sensitiveRules } from "./filter"

export function redactDiagnostic(text: string): string {
  let result = text
  for (const rule of sensitiveRules) {
    rule.pattern.lastIndex = 0
    result = result.replace(rule.pattern, `[REDACTED:${rule.reason}]`)
    rule.pattern.lastIndex = 0
  }
  return result
}
