export type SensitiveReason =
  | "api_key"
  | "password"
  | "private_key"
  | "connection_credential"
  | "env_secret"
  | "payment_or_identity"

export type SensitiveInspection =
  | { readonly safe: true; readonly value: string }
  | { readonly safe: false; readonly reasons: readonly SensitiveReason[] }

export interface SensitiveRule {
  readonly reason: SensitiveReason
  readonly pattern: RegExp
}

export const sensitiveRules: readonly SensitiveRule[] = [
  {
    reason: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/gi,
  },
  {
    reason: "connection_credential",
    pattern: /\b(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s:/]+:[^\s@]+@[^\s]+/gi,
  },
  {
    reason: "api_key",
    pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g,
  },
  {
    reason: "password",
    pattern: /\b(?:password|passwd|pwd|cookie)\s*[:=]\s*[^\s,;]+|\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
  },
  {
    reason: "env_secret",
    pattern: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*=\s*[^\s,;]+/gi,
  },
  {
    reason: "payment_or_identity",
    pattern: /\b(?:\d[ -]*?){13,19}\b|\b\d{17}[\dXx]\b/g,
  },
]

export function inspectSensitive(text: string): SensitiveInspection {
  const reasons: SensitiveReason[] = []
  for (const rule of sensitiveRules) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(text) && !reasons.includes(rule.reason)) reasons.push(rule.reason)
    rule.pattern.lastIndex = 0
  }
  return reasons.length > 0 ? { safe: false, reasons } : { safe: true, value: text }
}
