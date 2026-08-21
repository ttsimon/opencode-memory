# Local Installation And Release Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 升级 OpenCode Memory 到 OpenCode 1.18.19，冻结并验证唯一 tarball，在隔离及真实全局 OpenCode 环境完成完整合成 canary、回滚演练和首次 npm 发布验收。

**Architecture:** 兼容升级通过独立 PR 合并后，从干净 `main` 生成带 SHA-256 manifest 的唯一 tarball。先在隔离配置中从 tarball 安装并自动验收，再经密钥轮换、完整备份和人工确认安装到真实全局配置；首次 npm 发布是独立人工门禁，发布后从 registry 全新安装复验。

**Tech Stack:** Bun 1.3.14、OpenCode / plugin / SDK 1.18.19、`bun:test`、`bun:sqlite`、GitHub Actions、Changesets、npm CLI 11.5.1+、Node 22.14+ / 24。

## Global Constraints

- 设计来源：`docs/superpowers/specs/2026-08-21-local-install-release-validation-design.md`。
- 真实安装前必须把项目兼容基线升级到 OpenCode 1.18.19 并通过 required checks。
- Canary 与真实安装必须使用同一 SHA-256 tarball，不能用源码路径或 `dist/index.js` 替代。
- 不在任何文件、日志、报告或命令参数中保存真实 API Key。
- 当前全局配置中的已暴露密钥必须由用户在 provider 服务端轮换；代理不能代替该人工动作。
- 修改 `~/.config/opencode` 前必须完整备份；修改后必须退出并重启所有 OpenCode 实例。
- 真实 canary 只使用专用临时项目和 `OCM-CANARY-<timestamp>-` 合成数据。
- 首次 npm 发布必须由用户完成 npm 登录/2FA 并再次明确批准；本计划不得自动打开发布开关。
- `NPM_PUBLISH_ENABLED` 在本地验收与 bootstrap 发布期间保持未设置。
- 每个代码变化遵循 TDD，运行 focused tests；兼容升级和 tarball 工具运行 `bun run check`、`bun run test:e2e`。

---

## Human Gates

执行中遇到以下步骤必须暂停并等待用户完成/确认：

1. 在各 provider 服务端轮换已经暴露的真实密钥。
2. 将新密钥写入操作系统环境或凭据管理器。
3. 完成真实 OpenCode 重启并执行需要交互模型的 canary 对话。
4. 执行 `npm login` 和 2FA。
5. 首次公共 npm 发布前最终确认包名、版本和文件清单。
6. 在 npmjs.com 配置 Trusted Publisher 和发布访问策略。

## Planned Files

```text
scripts/canary/build-package.ts
scripts/canary/install-isolated.ts
scripts/canary/backup-global.ts
scripts/canary/install-global.ts
scripts/canary/restore-global.ts
scripts/canary/verify-install.ts
scripts/canary/cleanup-synthetic.ts
scripts/canary/types.ts
tests/unit/canary-package.test.ts
tests/unit/canary-config.test.ts
tests/integration/tarball-install.test.ts
docs/release-canary.md
docs/compatibility.md
README.md
package.json
bun.lock
tests/helpers/opencode-server.ts
```

## Task 1: Upgrade Compatibility To OpenCode 1.18.19

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tests/helpers/opencode-server.ts`
- Modify: `tests/unit/repository-config.test.ts`
- Modify: `README.md`
- Modify: `docs/compatibility.md`
- Modify: `docs/superpowers/specs/2026-08-20-repository-engineering-standards-design.md`
- Create: `.changeset/fresh-cats-upgrade.md`

**Interfaces:**
- Changes supported OpenCode/plugin/SDK version from `1.18.18` to exactly `1.18.19`.

- [ ] **Step 1: Write failing version invariant tests**

Update `tests/unit/repository-config.test.ts`:

```ts
expect(packageJson.dependencies["@opencode-ai/plugin"]).toBe("1.18.19")
expect(packageJson.dependencies["@opencode-ai/sdk"]).toBe("1.18.19")
expect(packageJson.devDependencies["opencode-ai"]).toBe("1.18.19")
```

Update the E2E helper expected version to `1.18.19` only after observing RED.

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/repository-config.test.ts`

Expected: FAIL because dependencies still equal 1.18.18.

- [ ] **Step 3: Upgrade exact dependencies and docs**

Run:

```text
bun add @opencode-ai/plugin@1.18.19 @opencode-ai/sdk@1.18.19
bun add --dev opencode-ai@1.18.19
```

Update all current compatibility statements to 1.18.19. Add:

```markdown
---
"@ttsimon/opencode-memory": patch
---

Validate and support OpenCode 1.18.19.
```

- [ ] **Step 4: Verify compatibility**

Run separately:

```text
bun test tests/unit/repository-config.test.ts
bun run check
bun run test:e2e
```

Expected: all pass against pinned `opencode-ai@1.18.19`.

- [ ] **Step 5: Commit, PR and required checks**

```bash
git add package.json bun.lock tests README.md docs .changeset/fresh-cats-upgrade.md
git commit -m "chore: support OpenCode 1.18.19"
git push -u origin chore/opencode-1.18.19-release-validation
gh pr create --base main --title "chore: support OpenCode 1.18.19" --body "Upgrade the exact OpenCode plugin, SDK, host dependency, compatibility documentation, and E2E baseline to 1.18.19."
gh pr checks --watch
```

Expected: all ten required checks pass, then squash merge. Do not continue Task 2 before `main` is updated to the merge commit.

### Task 2: Build And Freeze The Canary Tarball

**Files:**
- Create: `scripts/canary/types.ts`
- Create: `scripts/canary/build-package.ts`
- Create: `tests/unit/canary-package.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `buildCanaryPackage(input): Promise<CanaryManifest>`.
- Produces `<canary-dir>/canary-manifest.json` and one `.tgz`.

- [ ] **Step 1: Write failing manifest tests**

```ts
test("build manifest binds one tarball to commit and SHA-256", async () => {
  const manifest = await buildCanaryPackage({ repository: fixture.root, output: fixture.output })
  expect(manifest.package.name).toBe("@ttsimon/opencode-memory")
  expect(manifest.runtime.opencode).toBe("1.18.19")
  expect(manifest.tarball.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(manifest.tarball.files).toEqual([
    "package/LICENSE",
    "package/README.md",
    "package/dist/index.d.ts",
    "package/dist/index.js",
    "package/package.json",
  ])
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/canary-package.test.ts`

Expected: FAIL because build script is missing.

- [ ] **Step 3: Implement clean-main build**

The script must:

1. Require `git status --porcelain` to be empty.
2. Require local `HEAD == origin/main` and branch `main`.
3. Run frozen install, check and E2E as separate child processes.
4. Run `bun pm pack --destination <output>`.
5. Require exactly one `.tgz` and the existing five-file allowlist.
6. Compute SHA-256 with `Bun.CryptoHasher`.
7. Write atomic JSON manifest with commit, versions, path, SHA and file list.
8. Refuse to overwrite an existing canary directory.

Add script:

```json
"canary:build": "bun run scripts/canary/build-package.ts"
```

- [ ] **Step 4: Verify and commit**

Run: `bun test tests/unit/canary-package.test.ts && bun run check`.

Expected: PASS with no generated canary files tracked.

```bash
git add scripts/canary tests/unit/canary-package.test.ts package.json
git commit -m "build: add reproducible canary packaging"
```

### Task 3: Install Tarball In A Fully Isolated OpenCode Environment

**Files:**
- Create: `scripts/canary/install-isolated.ts`
- Create: `scripts/canary/verify-install.ts`
- Create: `tests/integration/tarball-install.test.ts`
- Modify: `tests/helpers/opencode-server.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `installIsolatedCanary(manifestPath): Promise<InstalledCanary>`.
- Verifies actual package-name loading, not file URL loading.

- [ ] **Step 1: Write failing tarball-install integration test**

```ts
test("installs the packed tarball and loads tool plus ten commands", async () => {
  const canary = await installIsolatedCanary(manifestPath)
  expect(canary.packageVersion).toBe(manifest.package.version)
  expect(canary.toolIds).toContain("memory")
  expect(canary.commandNames).toEqual(expect.arrayContaining(expectedCommands))
  expect(canary.dataFiles).toEqual(expect.arrayContaining(["memory.db"]))
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/integration/tarball-install.test.ts`.

Expected: FAIL because isolated tarball installer is missing.

- [ ] **Step 3: Implement isolated installation**

The installer must create config/data/cache/state/project/artifacts directories, run:

```text
bun add <absolute-tarball-path>
```

inside the isolated config, and write:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@ttsimon/opencode-memory"]
}
```

Reuse the bounded OpenCode server lifecycle helper, but add support for a package-name plugin and caller-provided isolated roots. Query tool IDs and commands. Invoke the health tool through the direct plugin harness if the public server has no direct tool-execute endpoint.

- [ ] **Step 4: Verify cleanup and data location**

Run: `bun test tests/integration/tarball-install.test.ts`.

Expected: PASS; no process remains; all memory files are below isolated data root; temporary root can be removed.

```bash
git add scripts/canary tests tests/helpers/opencode-server.ts package.json
git commit -m "test: add isolated tarball installation canary"
```

### Task 4: Prepare Secret Migration And Global Backup Tools

**Files:**
- Create: `scripts/canary/backup-global.ts`
- Create: `scripts/canary/install-global.ts`
- Create: `scripts/canary/restore-global.ts`
- Create: `scripts/canary/cleanup-synthetic.ts`
- Create: `tests/unit/canary-config.test.ts`
- Create: `docs/release-canary.md`

**Interfaces:**
- Produces safe JSONC patching, timestamped backup and idempotent restore.
- Does not read or print provider secret values.

- [ ] **Step 1: Write failing config transformation tests**

```ts
test("adds tarball dependency and plugin without changing unrelated config", () => {
  const result = patchGlobalConfig(original, manifest)
  expect(result.config.plugin).toEqual(["superpowers@git+https://github.com/obra/superpowers.git", "@ttsimon/opencode-memory"])
  expect(result.packageJson.dependencies["@ttsimon/opencode-memory"]).toBe(`file:${manifest.tarball.path}`)
  expect(result.config.mcp).toEqual(original.mcp)
})

test("rejects global install while literal provider secrets remain", () => {
  expect(() => validateNoLiteralProviderSecrets(configWithLiteralKey)).toThrow("rotate and migrate provider secrets")
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/canary-config.test.ts`.

Expected: FAIL because safe config helpers are missing.

- [ ] **Step 3: Implement backup/install/restore**

Backup must copy config, package manifests, lockfiles and plugins into a `0700` directory without printing content. Install must refuse if any `provider.*.options.apiKey` is not `{env:...}`. Patch JSONC atomically, preserve order, run Bun install, and write a redacted install receipt. Restore must stop on missing/incomplete backup and restore all copied paths atomically.

`cleanup-synthetic.ts` must delete only records and projection lines containing the exact canary prefix. It must never delete unrelated memory.

- [ ] **Step 4: Verify and commit**

Run: `bun test tests/unit/canary-config.test.ts && bun run check`.

Expected: config preservation, refusal, backup completeness, restore idempotency and prefix-only cleanup tests pass.

```bash
git add scripts/canary tests/unit/canary-config.test.ts docs/release-canary.md
git commit -m "chore: add safe global canary installation tools"
```

### Task 5: Human Gate — Rotate Secrets And Install The Canary Globally

**Files:**
- Modify outside repository: operating-system environment and `~/.config/opencode`.

- [ ] **Step 1: Stop and request provider key rotation**

Provide the user a checklist of provider entries that currently use literal `apiKey`, but never repeat values. Wait until the user confirms all old keys are revoked and replacement environment variables exist.

- [ ] **Step 2: Verify environment references without printing values**

Check only presence, e.g. `if ($env:CODEXCN_API_KEY) { "SET" } else { "MISSING" }`. Patch config values to `{env:VAR}` and run `opencode debug config` with secrets redacted from captured output.

- [ ] **Step 3: Build and freeze tarball from updated main**

Run `bun run canary:build <output>`. Verify manifest SHA independently.

- [ ] **Step 4: Run isolated tarball canary**

Run `bun run canary:isolated <manifest>`. Expected: PASS before any global change.

- [ ] **Step 5: Backup and install globally**

Run backup tool, record backup path, then global installer with manifest. Verify package dependency and plugin entry without dumping config.

- [ ] **Step 6: Restart OpenCode**

Stop only OpenCode processes after asking the user to close active work. Restart OpenCode from the synthetic canary project. If startup fails, immediately execute restore tool and verify original startup.

### Task 6: Complete Synthetic Canary And Rollback Drill

**Files:**
- Runtime artifacts only under local data and canary report directory.

- [ ] **Step 1: Create two temporary Git projects**

Use prefix `OCM-CANARY-<timestamp>-`. Record paths and project IDs.

- [ ] **Step 2: Execute full manual checklist**

Validate load, ten commands, global/project remember, search/show, ambiguous forget, ID forget, history, fake-secret rejection, cross-project isolation, automatic preference/decision, idle task snapshot, task resume, completed-task archive, compaction, global/project Markdown, delete cleanup and doctor.

For model-dependent steps, provide exact prompts and wait for user-observed results. Store only pass/fail, IDs and redacted messages in `canary-report.json`.

- [ ] **Step 3: Verify zero fake-secret persistence**

Search database bytes, Markdown, OpenCode logs and report for the fake secret string. Expected: zero matches.

- [ ] **Step 4: Execute rollback drill**

Stop OpenCode, restore backup, reinstall original dependencies, restart, verify superpowers/MCP/providers. Then reinstall the same tarball and restart again.

- [ ] **Step 5: Repeat smoke canary after reinstall**

Verify tool, commands, remember/search/forget/doctor. Clean synthetic records by exact prefix and remove temporary projects.

### Task 7: Human Gate — First npm Bootstrap Publication

**Files:**
- No repository changes before approval.

- [ ] **Step 1: Require npm login and scope verification**

Pause. User runs `npm login`, 2FA and confirms `npm whoami`. Verify ability to publish `@ttsimon` without printing auth configuration.

- [ ] **Step 2: Prepare release version via Changesets PR**

Enable only Changesets release-PR creation if needed; keep publish disabled. Merge release PR after required checks. Confirm final version, tag and changelog.

- [ ] **Step 3: Dry-run and explicit final approval**

Run `npm publish --dry-run --access public` from a clean checkout and show only package name, version, file list and sizes. Ask: `Publish @ttsimon/opencode-memory@<version> publicly?` Wait for explicit yes.

- [ ] **Step 4: Publish once**

Run `npm publish --access public` with interactive 2FA if requested. Verify `npm view @ttsimon/opencode-memory@<version>` and tag. Never store a token.

### Task 8: Configure Trusted Publishing And Registry Revalidation

**Files:**
- Modify: `docs/github-settings.md`
- Modify: Issue #2 state/checklist.

- [ ] **Step 1: Human configures npm Trusted Publisher**

Use user `ttsimon`, repo `opencode-memory`, workflow filename `release.yml`, allowed action `npm publish`. Set package publishing access to require 2FA and disallow traditional tokens.

- [ ] **Step 2: Verify GitHub release controls**

Confirm no `NPM_TOKEN`, release workflow has `id-token: write`, and `NPM_PUBLISH_ENABLED` remains disabled until the next approved release.

- [ ] **Step 3: Install from registry in a fresh isolated environment**

Run `bun add @ttsimon/opencode-memory@<version>` in a new isolated OpenCode config. Verify package source is registry, not `file:`. Run tool/command load plus remember/search/forget/history/doctor smoke.

- [ ] **Step 4: Verify provenance and close Issue #2**

Check npm provenance and GitHub Release/tag alignment. Update `docs/github-settings.md`, commit through PR if changed, and close Issue #2 with links to release and validation evidence.

## Final Acceptance Evidence

Required artifacts:

- OpenCode 1.18.19 compatibility PR URL and merge SHA.
- Canary manifest and tarball SHA-256.
- Isolated tarball canary report.
- Global backup receipt and restore drill result.
- Redacted synthetic canary report.
- npm package/version URL.
- GitHub Release/tag URL.
- npm provenance evidence.
- Registry-install revalidation report.

## Explicit Stop Conditions

- Literal provider secret remains in config.
- OpenCode version is not exactly 1.18.19.
- Tarball SHA differs from manifest.
- Isolated tarball canary fails.
- Backup is incomplete.
- Existing plugin/MCP/provider regresses.
- Any fake secret is found in persistent artifacts.
- Required GitHub checks fail.
- User has not explicitly approved public npm publication.
