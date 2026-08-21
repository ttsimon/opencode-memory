import { describe, expect, test } from "bun:test"
import { inspectSensitive, type SensitiveReason } from "../../src/security/filter"
import { redactDiagnostic } from "../../src/security/redaction"

describe("sensitive information boundary", () => {
  test.each([
    ["sk-proj-abcdefghijklmnopqrstuvwxyz123456", "api_key"],
    ["password=hunter2", "password"],
    ["-----BEGIN PRIVATE KEY-----\nabc", "private_key"],
    ["postgres://alice:secret@db.example/app", "connection_credential"],
    ["AWS_SECRET_ACCESS_KEY=abc123xyz", "env_secret"],
    ["token=abc123xyz", "env_secret"],
    ["Authorization: Bearer super-secret-token", "password"],
    ["4111 1111 1111 1111", "payment_or_identity"],
    ["11010519491231002X", "payment_or_identity"],
  ] satisfies ReadonlyArray<readonly [string, SensitiveReason]>)("rejects %s", (text, reason) => {
    const result = inspectSensitive(text)
    expect(result).toEqual({ safe: false, reasons: [reason] })
    expect(JSON.stringify(result)).not.toContain(text)
  })

  test("deduplicates reasons without returning matching source fragments", () => {
    const source = "password=hunter2 passwd=again"
    const result = inspectSensitive(source)
    expect(result).toEqual({ safe: false, reasons: ["password"] })
    expect(JSON.stringify(result)).not.toContain("hunter2")
  })

  test("reports overlapping categories without duplicating source text", () => {
    expect(inspectSensitive("PASSWORD=hunter2")).toEqual({
      safe: false,
      reasons: ["password"],
    })
  })

  test.each([
    "Use bun test for this repository",
    "The password field is validated by Zod",
    "postgres://localhost/app",
    "TOKEN_COUNT is not a secret",
  ])("allows benign content: %s", (text) => {
    expect(inspectSensitive(text)).toEqual({ safe: true, value: text })
  })

  test("redacts every supported sensitive category in diagnostics", () => {
    const diagnostic = redactDiagnostic(
      "password=hunter2 postgres://alice:secret@db/app sk-proj-abcdefghijklmnopqrstuvwxyz123456",
    )
    expect(diagnostic).not.toContain("hunter2")
    expect(diagnostic).not.toContain("alice:secret")
    expect(diagnostic).not.toContain("sk-proj-")
    expect(diagnostic).toContain("[REDACTED:password]")
    expect(diagnostic).toContain("[REDACTED:connection_credential]")
    expect(diagnostic).toContain("[REDACTED:api_key]")
  })

  test("redacts the complete bearer token", () => {
    const diagnostic = redactDiagnostic("Authorization: Bearer super-secret-token")
    expect(diagnostic).not.toContain("super-secret-token")
  })
})
