import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("repository governance files encode the approved workflow", async () => {
  expect(await readFile(".github/CODEOWNERS", "utf8")).toBe("* @ttsimon\n")
  expect(await readFile(".husky/pre-commit", "utf8")).toContain("bunx --bun lint-staged")
  expect(await readFile(".husky/commit-msg", "utf8")).toContain("bunx --bun commitlint --edit")
  const template = await readFile(".github/pull_request_template.md", "utf8")
  expect(template).toContain("Security impact")
  expect(template).toContain("OpenCode compatibility")
  expect(template).toContain("Database migration")
})
