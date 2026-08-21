import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("CI pins actions and exposes the approved required checks", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8")

  expect(workflow).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1")
  expect(workflow).toContain("jdx/mise-action@3c2e0cf82a5b2e5249f0d3635a4d83d0ae861518")
  expect(workflow).toContain("quality:")
  expect(workflow).toContain("test:")
  expect(workflow).toContain("e2e:")
  expect(workflow).toContain("pr-title:")
  expect(workflow).toContain("ubuntu-latest")
  expect(workflow).toContain("windows-latest")
  expect(workflow).toContain("macos-latest")
  expect(workflow).toContain("permissions:\n  contents: read")
  expect(workflow).toContain("cache: true")
  expect(workflow).not.toMatch(/uses:\s+[^\s]+@(v\d+|main|master|latest)\b/)
  expect(workflow).not.toContain("contents: write")
})

test("security and release workflows use pinned actions and scoped permissions", async () => {
  const security = await readFile(".github/workflows/security.yml", "utf8")
  const release = await readFile(".github/workflows/release.yml", "utf8")
  const renovate = JSON.parse(await readFile(".github/renovate.json", "utf8"))

  expect(security).toContain("github/codeql-action/init@3599b3baa15b485a2e49ef411a7a4bb2452e7f93")
  expect(security).toContain("github/codeql-action/analyze@3599b3baa15b485a2e49ef411a7a4bb2452e7f93")
  expect(security).toContain("gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7")
  expect(security).toContain("actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294")
  expect(security).not.toContain("contents: write")

  expect(release).toContain("changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1")
  expect(release).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020")
  expect(release).toContain("id-token: write")
  expect(release).toContain("contents: write")
  expect(release).toContain("pull-requests: write")
  expect(release).toContain("publish-script: bun run release")
  expect(release).toContain("version-script: bun run version-packages")
  expect(release).toContain("if: vars.NPM_PUBLISH_ENABLED == 'true'")
  expect(release).not.toContain("NPM_TOKEN")

  expect(renovate.extends).toContain("config:recommended")
  expect(renovate.rangeStrategy).toBe("pin")
  expect(renovate.automerge).toBe(false)
  expect(renovate.schedule).toEqual(["before 6am on monday"])
})
