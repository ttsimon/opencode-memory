import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("repository ownership and hooks encode the approved workflow", async () => {
  expect(await readFile(".github/CODEOWNERS", "utf8")).toBe("* @ttsimon\n")
  expect(await readFile(".husky/pre-commit", "utf8")).toContain("bunx --bun lint-staged")
  expect(await readFile(".husky/commit-msg", "utf8")).toContain('bunx --bun commitlint --edit "$1"')
})

test("commitlint enforces Conventional Commits with a 120 character header", async () => {
  const config = await readFile("commitlint.config.ts", "utf8")
  expect(config).toContain('extends: ["@commitlint/config-conventional"]')
  expect(config).toContain('"header-max-length": [2, "always", 120]')
})

test("pull requests capture every required review concern", async () => {
  const template = await readFile(".github/pull_request_template.md", "utf8")
  expect(template).toContain("## Summary")
  expect(template).toContain("## Test evidence")
  expect(template).toContain("Security impact")
  expect(template).toContain("OpenCode compatibility")
  expect(template).toContain("Database migration")
  expect(template).toContain("Documentation")
  expect(template).toContain("Changeset")
})

describe("issue forms", () => {
  test("bug reports require sanitized reproduction and version details", async () => {
    const form = await readFile(".github/ISSUE_TEMPLATE/bug-report.yml", "utf8")
    expect(form).toContain("name: Bug report")
    expect(form).toContain('title: "bug: "')
    expect(form).toContain("  - type: textarea\n    id: reproduction\n    attributes:")
    expect(form).toContain("  - type: textarea\n    id: versions\n    attributes:")
    expect(form).toContain("  - type: checkboxes\n    id: safety\n    attributes:")
    expect(form).toContain("required: true")
    expect(form).toContain("Do not include secrets")
    expect(form).toContain("`.env` contents")
  })

  test("feature requests require proposals, compatibility, and safe synthetic examples", async () => {
    const form = await readFile(".github/ISSUE_TEMPLATE/feature-request.yml", "utf8")
    expect(form).toContain("name: Feature request")
    expect(form).toContain('title: "feat: "')
    expect(form).toContain("  - type: textarea\n    id: problem\n    attributes:")
    expect(form).toContain("  - type: textarea\n    id: proposal\n    attributes:")
    expect(form).toContain("  - type: textarea\n    id: compatibility\n    attributes:")
    expect(form).toContain("  - type: checkboxes\n    id: safety\n    attributes:")
    expect(form).toContain("required: true")
    expect(form).toContain("Do not include secrets")
    expect(form).toContain("`.env` contents")
  })
})

test("the contribution guide documents the complete development workflow", async () => {
  const guide = await readFile("CONTRIBUTING.md", "utf8")
  expect(guide).toContain("mise install")
  expect(guide).toContain("bun install --frozen-lockfile")
  expect(guide).toContain("branch names")
  expect(guide).toContain("Conventional Commits")
  expect(guide).toContain("test-driven development")
  expect(guide).toContain("bun run check")
  expect(guide).toContain("E2E tests must be isolated")
  expect(guide).toContain("real user memory")
  expect(guide).toContain("real user configuration")
  expect(guide).toContain("Tests and fixtures")
})

test("the code of conduct identifies Contributor Covenant 2.1 and a private contact", async () => {
  const codeOfConduct = await readFile("CODE_OF_CONDUCT.md", "utf8")
  expect(codeOfConduct).toContain("Contributor Covenant")
  expect(codeOfConduct).toContain("version 2.1")
  expect(codeOfConduct).toContain("private reports")
  expect(codeOfConduct).toContain("simon.office@qq.com")
})

test("public documentation describes the current project accurately", async () => {
  const readme = await readFile("README.md", "utf8")
  expect(readme).toContain("health skeleton")
  expect(readme).toContain("Memory features are not yet released")
  expect(readme).toContain("local-only")
  expect(readme).toContain("OpenCode 1.18.18")
  expect(readme).toContain("Bun 1.3.14")

  const security = await readFile("SECURITY.md", "utf8")
  expect(security).toContain("private vulnerability reporting")
  expect(security).toContain("Do not disclose secrets in public issues")
  expect(security).toContain("0.x")
  expect(security).toContain("72 hours")
  expect(security).toContain("does not promise a fix deadline")

  const architecture = await readFile("docs/architecture.md", "utf8")
  expect(architecture).toContain("local-only")
  expect(architecture).toContain("health skeleton")
  expect(architecture).toContain("not yet implemented")

  expect(await readFile("LICENSE", "utf8")).toContain("MIT License")
  expect(await readFile("LICENSE", "utf8")).toContain("Copyright (c) 2026 Simon")
  const compatibility = await readFile("docs/compatibility.md", "utf8")
  expect(compatibility).toContain("OpenCode 1.18.18")
  expect(compatibility).toContain("Bun 1.3.14")
})

test("publishing metadata and ADRs are complete", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"))
  expect(packageJson.name).toBe("@ttsimon/opencode-memory")
  expect(packageJson.publishConfig).toEqual({ access: "public", provenance: true })
  expect(packageJson.repository.url).toBe("git+https://github.com/ttsimon/opencode-memory.git")
  expect(await readFile("docs/decisions/0002-bun-sqlite.md", "utf8")).toContain("bun:sqlite")
})
