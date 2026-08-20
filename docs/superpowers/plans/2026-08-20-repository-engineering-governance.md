# Repository Engineering Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 OpenCode Memory 的可复现 Bun 工具链、质量门禁、测试骨架、GitHub 治理、安全扫描和发布基础，使后续功能开发在受保护的 `main` 上按统一规范进行。

**Architecture:** 先用一次空仓库 bootstrap 提交建立远端 `main`，随后在 `chore/repository-governance` 分支完成全部治理内容并通过 PR 合并。仓库采用 Bun 1.3.14、Biome、严格 TypeScript、`bun:test`、Changesets 和 SHA 固定的 GitHub Actions；只提供无记忆业务逻辑的插件/工具骨架用于 OpenCode 1.18.18 宿主烟雾测试。

**Tech Stack:** mise、Bun 1.3.14、TypeScript 5.8.2、Biome 2.5.9、`bun:test`、OpenCode plugin/SDK 1.18.18、Husky 9.1.7、lint-staged 16.2.6、commitlint 19.8.1、Changesets 3.0.1、GitHub Actions、Renovate。

## Global Constraints

- 规范来源：`docs/superpowers/specs/2026-08-20-repository-engineering-standards-design.md`。
- 本计划不实现 SQLite 记忆模型、项目解析、安全过滤、召回、任务快照、自动提取或记忆管理业务。
- GitHub 仓库固定为 `https://github.com/ttsimon/opencode-memory.git`，npm 包固定为 `@ttsimon/opencode-memory`，许可证为 MIT。
- Bun 精确固定 `1.3.14`；OpenCode、`@opencode-ai/plugin` 和 `@opencode-ai/sdk` 精确固定 `1.18.18`。
- 唯一锁文件为 `bun.lock`；不得创建或提交 npm、pnpm、Yarn 锁文件。
- 使用 `bun:test` 和 `bun:sqlite` 技术基线，不引入 Vitest 或 `better-sqlite3`。
- Bun 原生覆盖率只强制 lines/functions 90%；关键分支用显式正反例测试保证。
- 第三方 GitHub Actions 必须使用本计划核验的完整 commit SHA，后续由 Renovate 更新。
- 不修改用户真实 OpenCode 全局配置，不执行 npm 正式发布。
- 空远端建立 `main` 所需的第一次 push 是唯一 bootstrap 例外；之后所有变更必须走 PR。

---

## Planned File Structure

```text
.changeset/config.json                 Changesets public package policy
.github/CODEOWNERS                     repository ownership
.github/ISSUE_TEMPLATE/*.yml           issue forms
.github/pull_request_template.md       PR quality checklist
.github/renovate.json                  dependency update policy
.github/workflows/ci.yml               quality, test matrix and E2E
.github/workflows/security.yml         CodeQL, Gitleaks and dependency review
.github/workflows/release.yml          Changesets release PR and trusted publishing
.husky/pre-commit                      staged-file checks
.husky/commit-msg                      Conventional Commit check
.editorconfig                          editor-neutral whitespace rules
.gitattributes                         LF normalization
.gitignore                             generated/local data exclusions
.mise.toml                             Bun 1.3.14 tool pin
biome.json                             formatting and lint rules
bunfig.toml                            test coverage configuration
commitlint.config.ts                   Conventional Commit rules
package.json                           package metadata and scripts
bun.lock                               exact dependency lock
tsconfig.json                          strict source/test checking
tsconfig.build.json                    declaration-only package build
src/index.ts                           minimal OpenCode plugin and health tool
scripts/clean.ts                       cross-platform dist cleanup
scripts/check-package.ts               packed file allowlist validation
scripts/check-markdown.ts              Markdown whitespace/EOF validation
tests/unit/repository-config.test.ts   version/config invariants
tests/unit/plugin-contract.test.ts     plugin export and health tool contract
tests/unit/governance-files.test.ts    repository policy files
tests/unit/workflow-policy.test.ts     pinned Actions and least privilege
tests/e2e/opencode-smoke.test.ts       real OpenCode 1.18.18 load test
tests/helpers/opencode-server.ts       isolated server lifecycle helper
README.md                              public project overview
CONTRIBUTING.md                        development and PR workflow
SECURITY.md                            reporting and supported versions
CODE_OF_CONDUCT.md                     contributor conduct
LICENSE                                MIT license
docs/architecture.md                   module boundaries and data flow
docs/compatibility.md                  Bun/OpenCode compatibility matrix
docs/decisions/0001-bun-toolchain.md   Bun + mise ADR
docs/decisions/0002-bun-sqlite.md      bun:sqlite ADR
docs/decisions/0003-command-routing.md command/tool routing ADR
docs/github-settings.md                manual repository settings checklist
```

## Verified Action Pins

Use these exact SHAs, with a trailing comment showing the human-readable release:

| Action | Commit SHA | Release |
| --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 |
| `jdx/mise-action` | `3c2e0cf82a5b2e5249f0d3635a4d83d0ae861518` | v4.2.5 |
| `github/codeql-action` | `3599b3baa15b485a2e49ef411a7a4bb2452e7f93` | v3.30.5 |
| `actions/dependency-review-action` | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | v5.0.0 |
| `gitleaks/gitleaks-action` | `ff98106e4c7b2bc287b24eaf42907196329070c7` | v2.3.9 |
| `changesets/action` | `8488615a623b1b9c987934bb89eae8af6a946ac1` | v2.1.1 |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 |

## Task 1: Bootstrap Git And Commit Approved Specifications

**Files:**
- Create: `.gitignore`
- Create: `.gitattributes`
- Existing: `docs/2026-08-20-opencode-memory-design.md`
- Existing: `docs/superpowers/specs/2026-08-20-repository-engineering-standards-design.md`
- Existing: `docs/superpowers/plans/2026-08-20-opencode-memory.md`
- Existing: `docs/superpowers/plans/2026-08-20-repository-engineering-governance.md`

**Interfaces:**
- Produces: local Git repository, `origin`, remote `main`, and working branch `chore/repository-governance`.

- [ ] **Step 1: Verify the empty remote and local non-repository state**

Run: `git ls-remote --symref https://github.com/ttsimon/opencode-memory.git HEAD`

Expected: no refs are printed because the remote is empty.

Run: `git status`

Expected: FAIL with `not a git repository`.

- [ ] **Step 2: Add the initial ignore and line-ending policy**

```gitignore
# Dependencies and build output
node_modules/
dist/
coverage/
*.tgz

# Local tools and editors
.mise.local.toml
.idea/
.vscode/

# Runtime and test data
*.db
*.db-shm
*.db-wal
*.log
.tmp/
tmp/

# OpenCode local state
.opencode/
opencode.json
opencode.jsonc

# Foreign package-manager lockfiles
package-lock.json
pnpm-lock.yaml
yarn.lock
```

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
```

- [ ] **Step 3: Initialize Git and inspect the exact bootstrap diff**

Run: `git init --initial-branch=main && git remote add origin https://github.com/ttsimon/opencode-memory.git && git status --short`

Expected: `.gitignore`, `.gitattributes`, and the approved documents are untracked; no source or generated files exist.

- [ ] **Step 4: Commit and push the bootstrap documents**

```bash
git add .gitignore .gitattributes docs
git commit -m "docs: establish project specifications"
git push -u origin main
git switch -c chore/repository-governance
```

Expected: remote `main` exists with only policy/docs bootstrap content; current branch is `chore/repository-governance`.

## Task 2: Pin Bun And Create The Quality Toolchain

**Files:**
- Create: `.mise.toml`
- Create: `.editorconfig`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `biome.json`
- Create: `bunfig.toml`
- Create: `tests/unit/repository-config.test.ts`
- Create: `bun.lock`

**Interfaces:**
- Produces scripts: `format`, `format:check`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `test`, `test:coverage`, `build`, `pack:check`, `check`.

- [ ] **Step 1: Write the failing repository invariant test**

```ts
import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("repository toolchain", () => {
  test("pins the host-compatible Bun and OpenCode versions", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"))
    const mise = await readFile(".mise.toml", "utf8")

    expect(packageJson.packageManager).toBe("bun@1.3.14")
    expect(packageJson.dependencies["@opencode-ai/plugin"]).toBe("1.18.18")
    expect(packageJson.dependencies["@opencode-ai/sdk"]).toBe("1.18.18")
    expect(packageJson.devDependencies["opencode-ai"]).toBe("1.18.18")
    expect(mise).toContain('bun = "1.3.14"')
  })

  test("uses Bun-native coverage thresholds", async () => {
    const bunfig = await readFile("bunfig.toml", "utf8")
    expect(bunfig).toContain("lines = 0.9")
    expect(bunfig).toContain("functions = 0.9")
  })
})
```

- [ ] **Step 2: Run the test before configuration exists**

Run: `mise exec -- bun test tests/unit/repository-config.test.ts`

Expected: FAIL with `ENOENT` for `package.json` or `.mise.toml`.

- [ ] **Step 3: Create the exact toolchain configuration**

```toml
# .mise.toml
min_version = { hard = "2025.1.0" }

[tools]
bun = "1.3.14"
```

```json
{
  "name": "@ttsimon/opencode-memory",
  "version": "0.1.0",
  "description": "Local persistent memory for OpenCode",
  "license": "MIT",
  "type": "module",
  "packageManager": "bun@1.3.14",
  "private": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "biome lint .",
    "docs:check": "bun run scripts/check-markdown.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "bun test tests/unit",
    "test:integration": "bun test tests/integration",
    "test:e2e": "bun test tests/e2e",
    "test": "bun test tests/unit tests/integration",
    "test:coverage": "bun test tests/unit tests/integration --coverage",
    "clean": "bun run scripts/clean.ts",
    "build": "bun run clean && bun build src/index.ts --outdir dist --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk && tsc -p tsconfig.build.json",
    "pack:check": "bun run scripts/check-package.ts",
    "check": "bun run format:check && bun run lint && bun run docs:check && bun run typecheck && bun run test:coverage && bun run build && bun run pack:check",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "changeset publish",
    "prepare": "husky"
  },
  "dependencies": {
    "@opencode-ai/plugin": "1.18.18",
    "@opencode-ai/sdk": "1.18.18",
    "zod": "4.1.8"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.9",
    "@changesets/cli": "3.0.1",
    "@commitlint/cli": "19.8.1",
    "@commitlint/config-conventional": "19.8.1",
    "@types/bun": "1.3.14",
    "husky": "9.1.7",
    "lint-staged": "16.2.6",
    "opencode-ai": "1.18.18",
    "typescript": "5.8.2"
  },
  "lint-staged": {
    "*.{ts,tsx,js,mjs,cjs,json,jsonc}": "biome check --write --no-errors-on-unmatched",
    "*.md": "bun run scripts/check-markdown.ts"
  }
}
```

`tsconfig.json` must use `module: "Preserve"`, `moduleResolution: "Bundler"`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, and `types: ["bun"]`. Include `src`, `scripts`, and `tests`. `tsconfig.build.json` extends it, includes only `src`, and sets `declaration: true`, `emitDeclarationOnly: true`, `outDir: "dist"`.

`biome.json` must set line width 120, spaces/2, LF, double quotes, trailing commas `all`, semicolons `asNeeded`, recommended lint preset, Git integration, `files.ignoreUnknown: true`, and force-ignore `node_modules`, `dist`, `coverage`, `.tmp`. Biome does not claim Markdown formatting support; Markdown whitespace is checked by `scripts/check-markdown.ts` in Task 3.

```toml
# bunfig.toml
[test]
coverageThreshold = { lines = 0.9, functions = 0.9 }
coverageReporter = ["text", "lcov"]
coverageSkipTestFiles = true
coveragePathIgnorePatterns = ["scripts/**"]
```

- [ ] **Step 4: Install exact dependencies and run the invariant test**

Run: `mise install && mise exec -- bun install`

Expected: Bun 1.3.14 is active and `bun.lock` is created.

Run: `mise exec -- bun test tests/unit/repository-config.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Verify no foreign lockfile exists**

Run: `git status --short`

Expected: `bun.lock` is present; no npm/pnpm/Yarn lockfile is listed.

- [ ] **Step 6: Commit**

```bash
git add .mise.toml .editorconfig package.json bun.lock tsconfig.json tsconfig.build.json biome.json bunfig.toml tests/unit/repository-config.test.ts
git commit -m "chore: add reproducible Bun toolchain"
```

## Task 3: Add The Minimal Typed Plugin And Package Build

**Files:**
- Create: `src/index.ts`
- Create: `scripts/clean.ts`
- Create: `scripts/check-package.ts`
- Create: `scripts/check-markdown.ts`
- Create: `tests/unit/plugin-contract.test.ts`

**Interfaces:**
- Produces: default and named `OpenCodeMemoryPlugin: Plugin`; custom tool ID `memory` with only `action: "health"` and deterministic output `OpenCode Memory is loaded.`
- Produces build artifacts: `dist/index.js`, `dist/index.d.ts`.

- [ ] **Step 1: Write the failing plugin contract test**

```ts
import { describe, expect, test } from "bun:test"
import plugin, { OpenCodeMemoryPlugin } from "../../src/index"

describe("plugin contract", () => {
  test("exports one OpenCode plugin function", () => {
    expect(plugin).toBe(OpenCodeMemoryPlugin)
    expect(typeof plugin).toBe("function")
  })

  test("registers a deterministic health-only memory tool", async () => {
    const hooks = await plugin(fakePluginInput())
    expect(Object.keys(hooks.tool ?? {})).toEqual(["memory"])
    const result = await hooks.tool?.memory.execute({ action: "health" }, fakeToolContext())
    expect(result).toBe("OpenCode Memory is loaded.")
  })
})
```

- [ ] **Step 2: Run the contract test to verify failure**

Run: `mise exec -- bun test tests/unit/plugin-contract.test.ts`

Expected: FAIL because `src/index.ts` and test helpers are missing.

- [ ] **Step 3: Implement the smallest host-loadable plugin**

```ts
import { tool, type Plugin } from "@opencode-ai/plugin"

export const OpenCodeMemoryPlugin: Plugin = async () => ({
  tool: {
    memory: tool({
      description: "Inspect OpenCode Memory plugin health.",
      args: {
        action: tool.schema.literal("health"),
      },
      async execute() {
        return "OpenCode Memory is loaded."
      },
    }),
  },
})

export default OpenCodeMemoryPlugin
```

The test file must define typed `fakePluginInput()` and `fakeToolContext()` locally with no `as any`; use `satisfies PluginInput`/`ToolContext` and no real filesystem or network access.

`scripts/clean.ts` removes only `dist` via `rm("dist", { recursive: true, force: true })`.

`scripts/check-markdown.ts` accepts optional file arguments; with no arguments it recursively checks tracked `.md` files under the repository while excluding `.git`, `node_modules`, `dist`, `coverage` and `.tmp`. It exits non-zero when a file contains CRLF, trailing spaces/tabs or lacks exactly one final newline, and prints only file path plus line number. It never rewrites files.

`scripts/check-package.ts` must run `bun pm pack --destination .tmp/package`, inspect the tarball listing with `tar -tf`, and fail unless every entry matches this allowlist:

```text
package/package.json
package/README.md
package/LICENSE
package/dist/index.js
package/dist/index.d.ts
```

Always remove `.tmp/package` in `finally`.

- [ ] **Step 4: Run contract, type and build verification**

Run: `mise exec -- bun run typecheck && mise exec -- bun test tests/unit/plugin-contract.test.ts && mise exec -- bun run build`

Expected: typecheck passes, 2 tests pass, and `dist/index.js` plus `dist/index.d.ts` exist.

- [ ] **Step 5: Run package allowlist check**

Run: `mise exec -- bun run pack:check`

Expected: PASS and temporary tarball files are removed.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts scripts/clean.ts scripts/check-package.ts scripts/check-markdown.ts tests/unit/plugin-contract.test.ts
git commit -m "chore: add typed plugin build skeleton"
```

## Task 4: Add Local Git Hooks And Contribution Policy Files

**Files:**
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`
- Create: `commitlint.config.ts`
- Create: `.github/CODEOWNERS`
- Create: `.github/pull_request_template.md`
- Create: `.github/ISSUE_TEMPLATE/bug-report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature-request.yml`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `tests/unit/governance-files.test.ts`

**Interfaces:**
- Produces: staged-file formatting/linting, commit-message validation, contribution and review templates.

- [ ] **Step 1: Write the failing governance-file test**

```ts
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
```

- [ ] **Step 2: Run the test to verify failure**

Run: `mise exec -- bun test tests/unit/governance-files.test.ts`

Expected: FAIL with missing governance files.

- [ ] **Step 3: Create hooks and Conventional Commit configuration**

```sh
# .husky/pre-commit
bunx --bun lint-staged
```

```sh
# .husky/commit-msg
bunx --bun commitlint --edit "$1"
```

```ts
// commitlint.config.ts
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 120],
  },
}
```

The PR template must include summary, test evidence, security impact, OpenCode compatibility, database migration, documentation, and changeset checkboxes. Issue forms must collect reproduction/version information without asking users to paste secrets or `.env` contents.

`CONTRIBUTING.md` must document `mise install`, frozen install, branch names, Conventional Commits, TDD, `bun run check`, E2E isolation, PR process, and the ban on real user memory/config fixtures.

Use Contributor Covenant 2.1 text for `CODE_OF_CONDUCT.md`.

- [ ] **Step 4: Install hooks and run validations**

Run: `mise exec -- bun run prepare && mise exec -- bun test tests/unit/governance-files.test.ts`

Expected: Husky initializes and the governance test passes.

Run: `"feat: validate commit policy" | mise exec -- bunx --bun commitlint`

Expected: PASS.

Run: `"invalid message" | mise exec -- bunx --bun commitlint`

Expected: FAIL with missing type/subject Conventional Commit errors.

- [ ] **Step 5: Commit**

```bash
git add .husky commitlint.config.ts .github/CODEOWNERS .github/pull_request_template.md .github/ISSUE_TEMPLATE CONTRIBUTING.md CODE_OF_CONDUCT.md tests/unit/governance-files.test.ts
git commit -m "chore: enforce contribution workflow"
```

## Task 5: Add License, Public Documentation, ADRs And Changesets

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `docs/architecture.md`
- Create: `docs/compatibility.md`
- Create: `docs/decisions/0001-bun-toolchain.md`
- Create: `docs/decisions/0002-bun-sqlite.md`
- Create: `docs/decisions/0003-command-routing.md`
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`
- Modify: `package.json`
- Modify: `tests/unit/governance-files.test.ts`

**Interfaces:**
- Produces: publishable package metadata, public docs, compatibility matrix and accepted architecture decisions.

- [ ] **Step 1: Extend the failing governance test**

```ts
test("publishing metadata and ADRs are complete", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"))
  expect(packageJson.name).toBe("@ttsimon/opencode-memory")
  expect(packageJson.publishConfig).toEqual({ access: "public", provenance: true })
  expect(packageJson.repository.url).toBe("git+https://github.com/ttsimon/opencode-memory.git")
  expect(await readFile("LICENSE", "utf8")).toContain("MIT License")
  expect(await readFile("docs/compatibility.md", "utf8")).toContain("OpenCode 1.18.18")
  expect(await readFile("docs/decisions/0002-bun-sqlite.md", "utf8")).toContain("bun:sqlite")
})
```

- [ ] **Step 2: Run the extended test to verify failure**

Run: `mise exec -- bun test tests/unit/governance-files.test.ts`

Expected: FAIL because public docs, license, ADRs and publish metadata are missing.

- [ ] **Step 3: Add exact package publication metadata**

Add to `package.json`:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ttsimon/opencode-memory.git"
  },
  "homepage": "https://github.com/ttsimon/opencode-memory#readme",
  "bugs": {
    "url": "https://github.com/ttsimon/opencode-memory/issues"
  },
  "keywords": ["opencode", "memory", "plugin", "local-first"],
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

Create MIT license with copyright `2026 Simon`.

README must state project status, local-only goal, supported OpenCode `1.18.18`, Bun development commands, that the current package contains only a health skeleton, and that memory features are not yet released.

`SECURITY.md` must provide GitHub private vulnerability reporting as the preferred channel, prohibit secrets in public issues, list `0.x` as supported during development, and define a best-effort 72-hour acknowledgement target without promising a fix deadline.

Each ADR must contain Status, Context, Decision, Alternatives, and Consequences. ADR 0003 must quote the verified limitation that `command.execute.before` mutates parts but cannot directly return/short-circuit a command.

```json
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.2/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 4: Run docs/metadata tests and package check**

Run: `mise exec -- bun test tests/unit/governance-files.test.ts && mise exec -- bun run build && mise exec -- bun run pack:check`

Expected: governance tests pass and the publish tarball allowlist remains exact.

- [ ] **Step 5: Commit**

```bash
git add LICENSE README.md SECURITY.md docs/architecture.md docs/compatibility.md docs/decisions .changeset package.json bun.lock tests/unit/governance-files.test.ts
git commit -m "docs: add public project governance"
```

## Task 6: Add Real OpenCode 1.18.18 E2E Smoke Coverage

**Files:**
- Create: `tests/helpers/opencode-server.ts`
- Create: `tests/e2e/opencode-smoke.test.ts`

**Interfaces:**
- Produces: `startIsolatedOpenCodeServer(input): Promise<RunningOpenCode>` with `{ baseUrl, stderr, stop() }`.
- Verifies endpoint `GET /experimental/tool/ids?directory=<fixture>` includes `memory`.

- [ ] **Step 1: Write the failing E2E test**

```ts
import { afterEach, expect, test } from "bun:test"
import { startIsolatedOpenCodeServer } from "../helpers/opencode-server"

let stop: (() => Promise<void>) | undefined

afterEach(async () => {
  await stop?.()
})

test("OpenCode 1.18.18 loads the built plugin and exposes its tool", async () => {
  const server = await startIsolatedOpenCodeServer({ plugin: new URL("../../dist/index.js", import.meta.url) })
  stop = server.stop

  const response = await fetch(`${server.baseUrl}/experimental/tool/ids?directory=${encodeURIComponent(server.projectDir)}`)
  expect(response.ok).toBe(true)
  expect(await response.json()).toContain("memory")
  expect(server.stderr()).not.toContain("failed to load plugin")
})
```

- [ ] **Step 2: Run before the helper exists**

Run: `mise exec -- bun run build && mise exec -- bun test tests/e2e/opencode-smoke.test.ts`

Expected: FAIL because `startIsolatedOpenCodeServer` is missing.

- [ ] **Step 3: Implement isolated server lifecycle**

The helper must:

1. Assert `bunx --bun opencode --version` equals `1.18.18` using the pinned `opencode-ai` dev dependency.
2. Create temporary config, data, cache, state and project directories.
3. Write isolated `opencode.json` containing `$schema` and the built plugin file URL.
4. Reserve a free `127.0.0.1` TCP port.
5. Spawn `bunx --bun opencode serve --hostname 127.0.0.1 --port <port> --print-logs` with isolated `OPENCODE_CONFIG_DIR`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` and Windows local-data variables.
6. Poll `/path?directory=<project>` until HTTP 200 or a 15-second timeout.
7. Capture stderr without printing secrets.
8. On `stop()`, terminate the child, wait for exit, and recursively remove the temporary root.

Use `AbortController` and a timeout; a failed start must kill the child and include redacted stderr in the thrown error.

- [ ] **Step 4: Run the real host smoke test**

Run: `mise exec -- bun run build && mise exec -- bun test tests/e2e/opencode-smoke.test.ts`

Expected: 1 E2E test passes; tool IDs include `memory`; no provider/model call occurs.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/opencode-server.ts tests/e2e/opencode-smoke.test.ts
git commit -m "test: add OpenCode host smoke coverage"
```

## Task 7: Add CI And Workflow Policy Tests

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tests/unit/workflow-policy.test.ts`

**Interfaces:**
- Produces required check names: `quality`, `test (ubuntu-latest)`, `test (windows-latest)`, `test (macos-latest)`, `e2e (ubuntu-latest)`, `e2e (windows-latest)`, `pr-title`.

- [ ] **Step 1: Write the failing workflow policy test**

```ts
import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("CI pins actions and exposes the approved required checks", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8")
  expect(workflow).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1")
  expect(workflow).toContain("jdx/mise-action@3c2e0cf82a5b2e5249f0d3635a4d83d0ae861518")
  expect(workflow).toContain("quality:")
  expect(workflow).toContain("e2e:")
  expect(workflow).not.toMatch(/uses:\s+[^\s]+@(v\d+|main|master|latest)\b/)
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `mise exec -- bun test tests/unit/workflow-policy.test.ts`

Expected: FAIL because `ci.yml` is missing.

- [ ] **Step 3: Implement `ci.yml` with least privilege**

Top-level requirements:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Jobs:

- `quality` on `ubuntu-latest`: checkout, mise, frozen install, `bun run check`.
- `test` matrix `[ubuntu-latest, windows-latest, macos-latest]`: frozen install, `bun run test`.
- `e2e` matrix `[ubuntu-latest, windows-latest]`: verify `bunx --bun opencode --version`, build, `bun run test:e2e`.
- `pr-title` on Ubuntu and only pull requests: pipe `${{ github.event.pull_request.title }}` into `bunx --bun commitlint`.

Every job must use the pinned checkout/mise SHAs from this plan. `mise-action` must enable cache; no job receives write permissions.

- [ ] **Step 4: Run workflow policy and full local verification**

Run: `mise exec -- bun test tests/unit/workflow-policy.test.ts && mise exec -- bun run check && mise exec -- bun run test:e2e`

Expected: policy test and all local gates pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/unit/workflow-policy.test.ts
git commit -m "ci: add cross-platform quality gates"
```

## Task 8: Add Security, Renovate And Release Automation

**Files:**
- Create: `.github/workflows/security.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/renovate.json`
- Modify: `tests/unit/workflow-policy.test.ts`

**Interfaces:**
- Produces: CodeQL, Gitleaks, dependency review, weekly dependency PRs, Changesets release PR and npm trusted-publishing command.

- [ ] **Step 1: Extend the failing workflow policy test**

```ts
test("security and release workflows use pinned actions and scoped permissions", async () => {
  const security = await readFile(".github/workflows/security.yml", "utf8")
  const release = await readFile(".github/workflows/release.yml", "utf8")

  expect(security).toContain("github/codeql-action/init@3599b3baa15b485a2e49ef411a7a4bb2452e7f93")
  expect(security).toContain("gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7")
  expect(security).toContain("actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294")
  expect(release).toContain("changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1")
  expect(release).toContain("id-token: write")
  expect(release).toContain("contents: write")
  expect(security).not.toContain("contents: write")
})
```

- [ ] **Step 2: Run the extended test to verify failure**

Run: `mise exec -- bun test tests/unit/workflow-policy.test.ts`

Expected: FAIL because security/release workflows are missing.

- [ ] **Step 3: Implement security and release workflows**

`security.yml` triggers on pull requests, pushes to `main`, and weekly schedule. It has:

- `codeql`: `security-events: write`, CodeQL init/analyze pinned to `3599...`.
- `gitleaks`: `contents: read`, full checkout history, pinned action `ff981...`.
- `dependency-review`: pull requests only, `contents: read`, pinned action `a1d...`, `fail-on-severity: high`.

`release.yml` triggers on pushes to `main`, grants only `contents: write`, `pull-requests: write`, and `id-token: write`, then runs checkout, mise, frozen install, `bun run check`, `bun run test:e2e`, and Changesets action. Configure:

Before publishing, use `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` with `node-version: 24` and `registry-url: https://registry.npmjs.org`. This Node installation exists only in the release Job because Changesets invokes npm for registry publication; local development, build and tests remain Bun-only.

```yaml
with:
  publish-script: bun run release
  version-script: bun run version-packages
  pr-title: "chore: release packages"
  commit-message: "chore: release packages"
```

Do not add `NPM_TOKEN`. Trusted publishing configuration is completed in Task 10 after the npm package exists or the npm UI allows pre-configuration.

`.github/renovate.json` must extend `config:recommended`, use weekly scheduling, pin digests, group non-major dev dependencies, separate major updates, group OpenCode plugin+SDK together, and keep Bun/TypeScript updates separate with automerge disabled globally.

- [ ] **Step 4: Run policy and full verification**

Run: `mise exec -- bun test tests/unit/workflow-policy.test.ts && mise exec -- bun run check && mise exec -- bun run test:e2e`

Expected: all policy, quality and host tests pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/security.yml .github/workflows/release.yml .github/renovate.json tests/unit/workflow-policy.test.ts
git commit -m "ci: add security and release automation"
```

## Task 9: Document GitHub Settings And Verify The Governance Branch

**Files:**
- Create: `docs/github-settings.md`
- Modify: `README.md`
- Modify: `tests/unit/governance-files.test.ts`

**Interfaces:**
- Produces: exact manual/`gh` checklist for repository features, branch protection and npm trusted publishing.

- [ ] **Step 1: Add the failing settings-document test**

```ts
test("GitHub settings checklist names all required protections", async () => {
  const settings = await readFile("docs/github-settings.md", "utf8")
  for (const item of [
    "Secret scanning",
    "Push protection",
    "Private vulnerability reporting",
    "Required status checks",
    "Trusted publishing",
  ]) {
    expect(settings).toContain(item)
  }
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `mise exec -- bun test tests/unit/governance-files.test.ts`

Expected: FAIL because `docs/github-settings.md` is missing.

- [ ] **Step 3: Write the operational checklist**

The document must include exact required checks:

```text
quality
test (ubuntu-latest)
test (windows-latest)
test (macos-latest)
e2e (ubuntu-latest)
e2e (windows-latest)
pr-title
```

It must document that a solo maintainer cannot approve their own PR, so initial protection requires PRs and passing checks but sets required approving reviews to 0. It must also list enabling Issues, private vulnerability reporting, dependency graph/alerts, secret scanning, push protection, Actions read/write policy, Renovate app installation, and npm trusted publisher setup for `.github/workflows/release.yml`.

README development status must link to the engineering standards, compatibility document and contribution guide.

- [ ] **Step 4: Run the complete branch verification**

Run: `mise exec -- bun run check && mise exec -- bun run test:e2e`

Expected: all local quality and real-host checks pass.

Run: `git status --short`

Expected: only the intended settings-doc changes are present before commit.

- [ ] **Step 5: Commit**

```bash
git add docs/github-settings.md README.md tests/unit/governance-files.test.ts
git commit -m "docs: add repository settings checklist"
```

## Task 10: Open The Governance PR, Enable Protections And Merge

**Files:**
- No source file changes expected.
- GitHub repository settings are changed through `gh` after inspection.

**Interfaces:**
- Produces: governance PR, protected `main`, enabled security features, and merged engineering baseline.

- [ ] **Step 1: Inspect the final branch before pushing**

Run in parallel:

```bash
git status --short
git diff main...HEAD --stat
git log --oneline --decorate main..HEAD
git remote -v
```

Expected: clean worktree; only governance files differ from `main`; origin is the approved GitHub URL.

- [ ] **Step 2: Push and create the PR**

```bash
git push -u origin chore/repository-governance
gh pr create --base main --head chore/repository-governance --title "chore: establish repository engineering governance" --body "Establishes the approved Bun toolchain, quality gates, tests, CI, security automation, release foundations, and public repository documentation. No memory business behavior is implemented."
```

Expected: command returns the PR URL.

- [ ] **Step 3: Wait for and inspect all PR checks**

Run: `gh pr checks --watch`

Expected: `quality`, all three platform tests, both E2E jobs, `pr-title`, security checks and dependency review pass. If any check fails, fix it in a new commit; do not bypass or disable the check.

- [ ] **Step 4: Inspect current GitHub settings before modifying them**

Run:

```bash
gh api repos/ttsimon/opencode-memory
gh api repos/ttsimon/opencode-memory/branches/main/protection
gh api repos/ttsimon/opencode-memory/private-vulnerability-reporting
```

Expected: repository exists; branch protection may return 404 because it has not been configured yet.

- [ ] **Step 5: Enable repository security features**

Use GitHub Settings UI or supported `gh api` endpoints to enable dependency graph/alerts, secret scanning, push protection and private vulnerability reporting. Do not guess unsupported API fields; verify each setting by reading it back. Install the Renovate GitHub App for this repository.

Expected: each item in `docs/github-settings.md` can be marked verified except npm trusted publishing, which may require the first npm package setup.

- [ ] **Step 6: Configure `main` branch protection with observed check names**

Create a temporary JSON request outside the workspace containing strict status checks, PR requirement with 0 required approvals, conversation resolution, admin enforcement, no force pushes and no deletion. Use exactly the check names observed in Step 3, then apply:

Run: `gh api --method PUT repos/ttsimon/opencode-memory/branches/main/protection --input <temporary-json-path>`

Expected: response reports `required_status_checks.strict = true`, `enforce_admins.enabled = true`, `required_pull_request_reviews.required_approving_review_count = 0`, force pushes disabled and deletion disabled.

- [ ] **Step 7: Squash merge and verify protected main**

Run: `gh pr merge --squash --delete-branch`

Expected: PR merges as `chore: establish repository engineering governance`; remote feature branch is deleted.

Run: `git switch main && git pull --ff-only && git status --short && git log --oneline -3`

Expected: local `main` is clean and contains the governance squash commit after the initial specifications commit.

- [ ] **Step 8: Record the remaining external release prerequisite**

If npm trusted publishing cannot be configured before the first package is created under the `@ttsimon` scope, leave it unchecked in `docs/github-settings.md` and open a GitHub issue titled `Configure npm trusted publishing before first release`. Do not add an `NPM_TOKEN` workaround.

## Final Verification

After Task 10, run from `D:\owner\opencode-memory`:

```bash
mise exec -- bun --version
mise exec -- bun install --frozen-lockfile
mise exec -- bun run check
mise exec -- bun run test:e2e
git status --short
gh api repos/ttsimon/opencode-memory/branches/main/protection
```

Expected:

- Bun prints `1.3.14`.
- Frozen install succeeds without lock changes.
- Quality, coverage, build and package allowlist pass.
- Real OpenCode 1.18.18 loads the plugin and exposes `memory`.
- Worktree is clean.
- `main` has strict required checks and cannot be force-pushed or deleted.

## Explicitly Deferred

- All memory business implementation.
- Real user OpenCode global installation.
- npm publication of `0.1.0`.
- npm trusted-publisher completion if npm requires the package to exist first.
- Rewriting `docs/superpowers/plans/2026-08-20-opencode-memory.md`; that is the next planning task after governance is merged.
