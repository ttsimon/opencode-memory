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
