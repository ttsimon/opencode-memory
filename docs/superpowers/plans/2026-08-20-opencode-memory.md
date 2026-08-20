# OpenCode Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OpenCode 1.18.18 实现一个纯本地、可审计、可降级的全局持久记忆插件，交付设计规格中的 MVP 和“自动记忆”阶段。

**Architecture:** 插件以 SQLite 为唯一事实源，Markdown 仅作为可重建投影；项目解析、安全过滤、存储、召回、任务快照和生命周期适配保持独立边界。OpenCode 适配层只依赖 1.18.18 实际公开的 `Plugin`、`Hooks`、`Event`、SDK client 和 custom tool 类型，所有 Hook 通过 fail-open 包装，管理命令由 `config` Hook 注册模板并路由到插件工具。

**Tech Stack:** TypeScript 5.8、Node.js 20+、OpenCode / `@opencode-ai/plugin` / `@opencode-ai/sdk` 1.18.18、`better-sqlite3` 12.4.1、Zod 4.1.8、Vitest 3.2.4。

## Global Constraints

- 范围只包含设计规格 `docs/2026-08-20-opencode-memory-design.md` 的 MVP 和“自动记忆”；不实现 `/memory-edit`、`/memory-restore`、`/memory-export`、`/memory-import`、向量检索、Git 团队记忆或同步。
- 所有记忆数据只写入用户本地应用数据目录；Windows 默认根目录为 `%LOCALAPPDATA%\opencode-memory`，不得写入项目仓库。
- SQLite 是结构化记忆、任务快照和审计历史的唯一事实来源；Markdown 是可重建投影。
- 敏感过滤必须先于数据库、Markdown、备份、诊断和日志写入；拒绝事件不得保存原文、哈希或可逆摘要。
- 当前用户指令和当前仓库事实优先于历史记忆；注入文本必须包含这一优先级提示。
- 默认召回上限：全局核心 8 条、项目核心 12 条、动态记忆 8 条、活动任务 1 份、总预算约 2,000 Token。
- 插件内部错误不得阻断 OpenCode 对话、命令或工具执行；同类降级警告每次插件实例最多显示一次。
- OpenCode 全局配置只能在基础测试、降级测试和安装烟雾测试通过后修改；修改后必须退出并重启 OpenCode。
- 自动提取使用确定性、本地规则，只自动保存高置信候选；不调用外部 embedding、外部记忆服务或额外云端模型。
- 每个任务遵循 TDD：先写失败测试并观察预期失败，再写最小实现，再运行局部和相关回归测试。

---

## OpenCode 1.18.18 API 核对结论

以下结论已经以已安装的 `opencode --version`、npm 发布包和 `anomalyco/opencode` 的 `v1.18.18` 标签源码交叉核对，实施时不得换成猜测接口。

- 已安装 CLI 为 `1.18.18`；依赖必须固定为 `@opencode-ai/plugin@1.18.18` 和 `@opencode-ai/sdk@1.18.18`。
- 插件入口签名为 `Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>`；`PluginInput` 提供 `client`、`project`、`directory`、`worktree`、`serverUrl` 和 Bun shell `$`。
- `chat.message` 输入为 `{ sessionID, agent?, model?, messageID?, variant? }`，输出为 `{ message: UserMessage, parts: Part[] }`；它在用户消息持久化前触发，适合读取本轮文本、生成候选和准备召回缓存。
- `experimental.chat.system.transform` 输入包含 `{ sessionID?, model }`，可向 `output.system: string[]` 追加记忆上下文；实际主会话路径会传入 `sessionID`。
- `experimental.chat.messages.transform` 没有 `sessionID` 输入，并且也会在 compaction 路径调用；本项目不用它做主召回注入，避免会话归属不明确和重复注入。
- `session.idle` 是 `event({ event })` 收到的联合类型事件，不是独立 Hook；载荷为 `{ type: "session.idle", properties: { sessionID } }`。
- `experimental.session.compacting` 输入为 `{ sessionID }`，输出为 `{ context: string[]; prompt?: string }`；本项目只追加 `context`，不替换 OpenCode 默认 prompt。
- `command.execute.before` 输入为 `{ command, sessionID, arguments }`，输出仅有可变的 `parts: Part[]`；它不能短路命令、不能直接返回数据库结果。
- 自定义命令只能通过 `config.command[name] = { template, description, ... }` 或 Markdown 文件注册；插件 `config` Hook 在 Command 服务读取配置前执行，因此可动态注册命令。
- 管理命令采用“命令模板/`command.execute.before` 强制路由 -> 插件 custom tool -> 数据库”的结构。模板要求模型只调用 `memory` 工具并逐字返回结果；数据库逻辑不放在提示词中。
- custom tool 使用 `tool({ description, args, execute })`；`execute` 上下文含 `sessionID`、`messageID`、`directory`、`worktree`、`abort`、`metadata()` 和 `ask()`。
- 会话收尾可调用 `client.session.messages({ path: { id: sessionID }, query: { directory } })`；返回 `Array<{ info: Message; parts: Part[] }>`。
- 非阻断反馈可调用 `client.tui.showToast({ body: { message, variant, duration }, query: { directory } })`；结构化日志使用 `client.app.log(...)`，日志内容必须先脱敏。
- OpenCode 会顺序执行多个插件 Hook，但不会替外部 Hook 捕获运行时异常；本插件必须在每个 Hook 边界自行捕获异常。

权威参考：

- `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.18/packages/plugin/src/index.ts`
- `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.18/packages/opencode/src/plugin/index.ts`
- `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.18/packages/opencode/src/session/prompt.ts`
- `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.18/packages/opencode/src/session/compaction.ts`
- `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.18/packages/opencode/src/session/status.ts`
- `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.18/packages/opencode/src/command/index.ts`
- `https://opencode.ai/docs/plugins/`
- `https://opencode.ai/docs/commands/`

## Planned File Structure

```text
package.json                         package metadata, pinned runtime dependencies and scripts
tsconfig.json                        strict ESM TypeScript build
vitest.config.ts                     unit/integration test configuration
src/index.ts                         OpenCode plugin entry and Hook composition
src/config.ts                        plugin options, defaults and command registration
src/types.ts                         shared domain types and public interfaces
src/paths.ts                         local data paths and directory permissions
src/project-resolver.ts              Git/worktree/non-Git project identity
src/security.ts                      secret/privacy detection and final redaction gate
src/store/migrations.ts              schema versions, backup-before-migrate and FTS setup
src/store/store.ts                   SQLite repository and transaction boundary
src/store/queries.ts                 SQL row mapping and focused query helpers
src/memory-service.ts                write pipeline, dedupe, conflict and audit orchestration
src/task-service.ts                  one-active-task lifecycle
src/recall.ts                        FTS query, ranking, budgets and rendered context
src/session-state.ts                 per-session recall/status/event buffers
src/commands.ts                      command definitions and strict tool-routing parts
src/tool.ts                          `memory` custom tool action dispatcher
src/extraction.ts                    deterministic high-confidence candidate extraction
src/lifecycle.ts                     chat, idle, compaction and event adapters
src/markdown.ts                      MEMORY.md/topics projection and rebuild
src/doctor.ts                        non-destructive diagnostics and recovery guidance
src/runtime.ts                       fail-open wrapper, once-only warning and safe logging
tests/helpers/database.ts            isolated temp database fixture
tests/helpers/git.ts                 Git repository/worktree fixture
tests/helpers/plugin.ts              fake OpenCode client and Hook harness
tests/*.test.ts                      focused unit and integration tests
tests/e2e/opencode-smoke.test.ts     real OpenCode 1.18.18 startup/config smoke test
README.md                            installation, commands, data paths and recovery
```

## Phase 1: MVP

### Task 1: Project Scaffold And API Contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `tests/api-contract.test.ts`

**Interfaces:**
- Consumes: OpenCode 1.18.18 `Plugin`, `Hooks`, `tool` and SDK types.
- Produces: named export `OpenCodeMemoryPlugin: Plugin` and default export; scripts `test`, `test:watch`, `typecheck`, `build`.

- [ ] **Step 1: Write the failing API contract test**

```ts
import { describe, expect, it } from "vitest"
import plugin from "../src/index.js"

describe("OpenCodeMemoryPlugin", () => {
  it("exports an OpenCode plugin function", () => {
    expect(typeof plugin).toBe("function")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/api-contract.test.ts`

Expected: FAIL because `package.json`, Vitest configuration, or `src/index.ts` does not exist.

- [ ] **Step 3: Create the minimal pinned project scaffold**

```json
{
  "name": "opencode-memory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@opencode-ai/plugin": "1.18.18",
    "@opencode-ai/sdk": "1.18.18",
    "better-sqlite3": "12.4.1",
    "jsonc-parser": "3.3.1",
    "zod": "4.1.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.13",
    "@types/node": "24.3.0",
    "typescript": "5.8.2",
    "vitest": "3.2.4"
  }
}
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
  },
})
```

```ts
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"

export const OpenCodeMemoryPlugin: Plugin = async () => ({})

export default OpenCodeMemoryPlugin
```

- [ ] **Step 4: Install, typecheck and run the contract test**

Run: `npm install`

Expected: dependencies install successfully and `package-lock.json` is created.

Run: `npm run typecheck && npm test -- tests/api-contract.test.ts`

Expected: typecheck succeeds; 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/index.ts tests/api-contract.test.ts
git commit -m "chore: scaffold opencode memory plugin"
```

### Task 2: Domain Types, Data Paths And Project Identity

**Files:**
- Create: `src/types.ts`
- Create: `src/paths.ts`
- Create: `src/project-resolver.ts`
- Create: `tests/paths.test.ts`
- Create: `tests/project-resolver.test.ts`
- Create: `tests/helpers/git.ts`

**Interfaces:**
- Produces: `resolveDataPaths(env, platform): DataPaths`; `resolveProject(input): Promise<ProjectScope>`.
- `ProjectScope = { projectId: string; root: string; identity: string; kind: "git" | "path" }`.

- [ ] **Step 1: Write failing data path tests**

```ts
it("uses LOCALAPPDATA on Windows and never the repository", () => {
  const paths = resolveDataPaths({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32")
  expect(paths.root).toBe("C:\\Users\\me\\AppData\\Local\\opencode-memory")
  expect(paths.database).toBe(`${paths.root}\\memory.db`)
})

it("requests owner-only modes for created data paths", async () => {
  const fs = recordingFileSystem()
  await ensureDataPaths(testPaths, fs)
  expect(fs.createdDirectories.every((entry) => entry.mode === 0o700)).toBe(true)
})
```

- [ ] **Step 2: Write failing project resolver tests**

```ts
it("maps a repository root, child directory and linked worktree to one project id", async () => {
  const fixture = await createGitWorktreeFixture()
  const ids = await Promise.all([
    resolveProject({ directory: fixture.root, worktree: fixture.root }),
    resolveProject({ directory: fixture.child, worktree: fixture.root }),
    resolveProject({ directory: fixture.linkedWorktree, worktree: fixture.linkedWorktree }),
  ])
  expect(new Set(ids.map((item) => item.projectId)).size).toBe(1)
  expect(ids[0].projectId).toMatch(/^[a-f0-9]{32}$/)
  expect(ids[0].projectId).not.toContain(fixture.root)
})
```

- [ ] **Step 3: Run tests to verify expected failures**

Run: `npm test -- tests/paths.test.ts tests/project-resolver.test.ts`

Expected: FAIL with missing `resolveDataPaths` and `resolveProject` exports.

- [ ] **Step 4: Implement normalized, non-reversible identities**

```ts
export type ProjectScope = {
  projectId: string
  root: string
  identity: string
  kind: "git" | "path"
}

export async function resolveProject(input: { directory: string; worktree: string }): Promise<ProjectScope> {
  const commonDir = await gitCommonDir(input.directory)
  const root = commonDir ? await canonicalGitRoot(commonDir) : await realpath(input.directory)
  const identity = commonDir ? `git:${normalizePath(root)}` : `path:${normalizePath(root)}`
  return {
    projectId: createHash("sha256").update(identity).digest("hex").slice(0, 32),
    root,
    identity,
    kind: commonDir ? "git" : "path",
  }
}
```

Implementation detail: `gitCommonDir()` must execute `git rev-parse --path-format=absolute --git-common-dir`; for a linked worktree, derive repository identity from the common Git directory, then normalize to the main repository root. If Git exits non-zero, use `realpath(directory)` with case-folding on Windows.

`resolveDataPaths()` must create the root, backup, global, project and topic directories with owner-only permissions where the platform supports POSIX modes (`0o700` for directories, `0o600` for files). On Windows, it must use a directory under the current user's `%LOCALAPPDATA%` and doctor must report, rather than silently claim, whether ACL verification is available.

- [ ] **Step 5: Run resolver tests**

Run: `npm test -- tests/paths.test.ts tests/project-resolver.test.ts`

Expected: PASS for root/child/worktree identity, different-repository isolation, non-Git stability and hidden path digest.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/paths.ts src/project-resolver.ts tests/paths.test.ts tests/project-resolver.test.ts tests/helpers/git.ts
git commit -m "feat: resolve local data and project scopes"
```

### Task 3: Sensitive Content Hard Filter

**Files:**
- Create: `src/security.ts`
- Create: `tests/security.test.ts`

**Interfaces:**
- Produces: `inspectSensitive(text): SensitiveResult`; `assertSafe(text): SafeText`; `redactDiagnostic(value): string`.
- `SensitiveResult = { safe: true; value: string } | { safe: false; reasons: SensitiveReason[] }`.

- [ ] **Step 1: Write the failing table-driven security tests**

```ts
it.each([
  ["sk-proj-abcdefghijklmnopqrstuvwxyz123456", "api_key"],
  ["password=hunter2", "password"],
  ["-----BEGIN PRIVATE KEY-----\nabc", "private_key"],
  ["postgres://alice:secret@db.example/app", "connection_credential"],
  ["AWS_SECRET_ACCESS_KEY=abc123xyz", "env_secret"],
])("rejects %s", (text, reason) => {
  expect(inspectSensitive(text)).toEqual({ safe: false, reasons: expect.arrayContaining([reason]) })
})

it("does not return rejected source text", () => {
  expect(JSON.stringify(inspectSensitive("password=hunter2"))).not.toContain("hunter2")
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/security.test.ts`

Expected: FAIL because `src/security.ts` does not exist.

- [ ] **Step 3: Implement the ordered hard-filter rules**

```ts
const RULES: ReadonlyArray<{ reason: SensitiveReason; pattern: RegExp }> = [
  { reason: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { reason: "connection_credential", pattern: /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s:/]+:[^\s@]+@/i },
  { reason: "api_key", pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/ },
  { reason: "password", pattern: /\b(?:password|passwd|pwd|cookie|authorization)\s*[:=]\s*\S+/i },
  { reason: "env_secret", pattern: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/i },
  { reason: "payment_or_identity", pattern: /\b(?:\d[ -]*?){13,19}\b|\b\d{17}[\dXx]\b/ },
]
```

`redactDiagnostic()` must replace matching substrings with `[REDACTED:<reason>]`; rejected audit events may persist only the reason list and operation metadata.

- [ ] **Step 4: Run security tests and mutation cases**

Run: `npm test -- tests/security.test.ts`

Expected: all positive samples are rejected, benign code/config samples remain safe, and serialized results contain no source secret.

- [ ] **Step 5: Commit**

```bash
git add src/security.ts tests/security.test.ts
git commit -m "feat: block sensitive memory content"
```

### Task 4: SQLite Schema, FTS, Migrations And Backups

**Files:**
- Create: `src/store/migrations.ts`
- Create: `src/store/store.ts`
- Create: `src/store/queries.ts`
- Create: `tests/helpers/database.ts`
- Create: `tests/store-schema.test.ts`
- Create: `tests/migrations.test.ts`

**Interfaces:**
- Produces: `openMemoryStore(paths, options?): MemoryStore`; `MemoryStore.close()`.
- Schema tables: `schema_migrations`, `memories`, `memory_fts`, `task_snapshots`, `audit_events`, `processed_events`, `settings`, `pending_events`.

- [ ] **Step 1: Write failing schema and FTS tests**

```ts
it("creates the memory schema and FTS index", () => {
  const store = openTestStore()
  expect(store.schemaVersion()).toBe(1)
  expect(store.rawTableNames()).toEqual(expect.arrayContaining([
    "memories", "memory_fts", "task_snapshots", "audit_events", "processed_events", "settings", "pending_events",
  ]))
})
```

- [ ] **Step 2: Write failing backup retention test**

```ts
it("backs up before migration and retains only the newest three backups", () => {
  const fixture = createVersionZeroDatabaseWithFourBackups()
  const store = openMemoryStore(fixture.paths)
  store.close()
  expect(listBackups(fixture.paths.backups)).toHaveLength(3)
})

it("leaves the pre-migration backup restorable when migration fails", () => {
  const fixture = createDatabaseThatFailsMigration()
  expect(() => openMemoryStore(fixture.paths)).toThrow(/migration/i)
  expect(openBackupReadOnly(fixture.latestBackup).integrityCheck()).toBe("ok")
})
```

- [ ] **Step 3: Run tests to observe failure**

Run: `npm test -- tests/store-schema.test.ts tests/migrations.test.ts`

Expected: FAIL because the store and migrations are missing.

- [ ] **Step 4: Implement migration 1 in one transaction**

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'rule', 'fact', 'decision', 'insight', 'task')),
  content TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'archived', 'deleted')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  importance REAL NOT NULL CHECK (importance BETWEEN 0 AND 1),
  source_session_id TEXT,
  source_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_recalled_at TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  supersedes_id TEXT REFERENCES memories(id),
  CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX memories_source_unique
  ON memories(source_session_id, source_message_id, kind, normalized_content)
  WHERE source_session_id IS NOT NULL AND source_message_id IS NOT NULL;
CREATE VIRTUAL TABLE memory_fts USING fts5(content, kind, scope, project_id UNINDEXED, content='memories', content_rowid='rowid');
```

Add insert/update/delete triggers that keep `memory_fts` synchronized. Before applying any migration to an existing database, close WAL checkpoints, copy the database to `backups/memory-v<old>-<timestamp>.db`, then retain the newest three files.

- [ ] **Step 5: Run schema and migration tests**

Run: `npm test -- tests/store-schema.test.ts tests/migrations.test.ts`

Expected: schema version is 1, FTS triggers update correctly, failed migrations roll back, and backup retention is 3.

- [ ] **Step 6: Commit**

```bash
git add src/store tests/helpers/database.ts tests/store-schema.test.ts tests/migrations.test.ts
git commit -m "feat: add sqlite memory store"
```

### Task 5: Memory Write Pipeline, Audit And Soft Delete

**Files:**
- Create: `src/memory-service.ts`
- Create: `tests/memory-service.test.ts`
- Create: `tests/audit.test.ts`

**Interfaces:**
- Consumes: `MemoryStore`, `inspectSensitive`, `ProjectScope`.
- Produces: `classifyManualMemory(text, projectId): Pick<MemoryCandidate, "scope" | "projectId" | "kind" | "confidence" | "importance">`; `MemoryService.remember(candidate)`, `search(input)`, `get(id)`, `forget(selector)`, `history(id?)`.
- `RememberResult = { outcome: "created" | "updated" | "superseded" | "rejected"; memory?: MemoryRecord; reasons?: SensitiveReason[] }`.

- [ ] **Step 1: Write failing remember and idempotency tests**

```ts
it("writes a safe memory and one audit event", () => {
  const result = service.remember(candidate({ content: "Use pnpm in this project" }))
  expect(result.outcome).toBe("created")
  expect(store.listAudit()).toMatchObject([{ operation: "create", toStatus: "active" }])
})

it("does not duplicate the same source event", () => {
  service.remember(candidate({ sourceMessageId: "msg-1" }))
  service.remember(candidate({ sourceMessageId: "msg-1" }))
  expect(store.countMemories()).toBe(1)
})
```

- [ ] **Step 2: Write failing sensitive and ambiguous delete tests**

```ts
it("rejects secrets before all persistence", () => {
  const result = service.remember(candidate({ content: "password=hunter2" }))
  expect(result.outcome).toBe("rejected")
  expect(store.dumpAllText()).not.toContain("hunter2")
})

it("refuses ambiguous keyword deletion", () => {
  seedTwoMatchingMemories("typescript")
  expect(service.forget({ query: "typescript" })).toEqual({ outcome: "ambiguous", ids: expect.any(Array) })
  expect(store.countByStatus("deleted")).toBe(0)
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/memory-service.test.ts tests/audit.test.ts`

Expected: FAIL because `MemoryService` is missing.

- [ ] **Step 4: Implement the ordered write transaction**

```ts
remember(candidate: MemoryCandidate): RememberResult {
  const safety = inspectSensitive(candidate.content)
  if (!safety.safe) return this.recordRejected(candidate, safety.reasons)
  if (candidate.confidence < this.options.autoSaveConfidence) return { outcome: "rejected", reasons: ["low_confidence"] }
  return this.store.transaction(() => {
    const duplicate = this.store.findBySourceOrNormalized(candidate)
    if (duplicate) return this.updateDuplicate(duplicate, candidate)
    const conflict = this.store.findConflict(candidate)
    if (conflict) return this.supersede(conflict, candidate)
    return this.create(candidate)
  })
}
```

`forget({ id })` must soft-delete exactly one record and append an audit event. `forget({ query })` may delete only when search returns exactly one active record; zero returns `not_found`, multiple returns `ambiguous` with IDs and summaries.

`classifyManualMemory()` must classify explicit communication/cross-project wording as global preference, explicit repository wording as project rule, explicit decisions as project decision, and all uncertain cases as project fact. Manual `/remember` uses confidence `1.0` because the user explicitly requested persistence, but it still passes through the hard sensitive filter.

- [ ] **Step 5: Run memory and audit tests**

Run: `npm test -- tests/memory-service.test.ts tests/audit.test.ts`

Expected: create/update/idempotency/soft-delete/audit tests pass; sensitive source text is absent from every table.

- [ ] **Step 6: Commit**

```bash
git add src/memory-service.ts tests/memory-service.test.ts tests/audit.test.ts
git commit -m "feat: add auditable memory write pipeline"
```

### Task 6: Task Snapshot Lifecycle

**Files:**
- Create: `src/task-service.ts`
- Create: `tests/task-service.test.ts`

**Interfaces:**
- Produces: `TaskService.getActive(projectId)`, `replace(snapshot)`, `archive(projectId, reason)`.
- `TaskSnapshot` contains goal, status, completed, inProgress, files, decisions, blockers, nextSteps, updatedAt and sourceSessionId.

- [ ] **Step 1: Write failing one-active-task tests**

```ts
it("keeps at most one active task per project", () => {
  tasks.replace(snapshot({ goal: "Implement search" }))
  tasks.replace(snapshot({ goal: "Fix unrelated login bug" }))
  expect(tasks.list("project-1").map((item) => item.status)).toEqual(["archived", "active"])
})

it("does not inject completed tasks", () => {
  tasks.replace(snapshot({ status: "completed" }))
  expect(tasks.getActive("project-1")).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/task-service.test.ts`

Expected: FAIL because `TaskService` is missing.

- [ ] **Step 3: Implement transactional replacement and audit relations**

```ts
replace(next: TaskSnapshot): TaskSnapshot {
  return this.store.transaction(() => {
    const current = this.store.getActiveTask(next.projectId)
    if (current && current.goal !== next.goal) this.store.archiveTask(current.id, "replaced_by_new_goal")
    const saved = this.store.upsertActiveTask(next)
    this.store.appendAudit({ operation: "task_update", entityId: saved.id, sourceSessionId: next.sourceSessionId })
    return saved
  })
}
```

- [ ] **Step 4: Run task tests**

Run: `npm test -- tests/task-service.test.ts`

Expected: PASS; each project has zero or one active snapshot and replacement is auditable.

- [ ] **Step 5: Commit**

```bash
git add src/task-service.ts tests/task-service.test.ts
git commit -m "feat: persist resumable task snapshots"
```

### Task 7: FTS Recall, Ranking And Context Budget

**Files:**
- Create: `src/recall.ts`
- Create: `tests/recall.test.ts`

**Interfaces:**
- Produces: `RecallEngine.recall(input): RecallResult`; `renderRecall(result): string | undefined`.
- `RecallInput = { projectId, query, recentTopics, currentFiles, now, tokenBudget?: number }`.

- [ ] **Step 1: Write failing scope, status and relevance tests**

```ts
it("recalls global preferences and only the current project's memories", () => {
  seedRecallFixture()
  const result = recall.recall({ projectId: "alpha", query: "How do we run tests?", recentTopics: [], currentFiles: [], now })
  expect(result.items.map((item) => item.content)).toContain("Use Chinese for replies")
  expect(result.items.map((item) => item.content)).toContain("Run npm test")
  expect(result.items.map((item) => item.content)).not.toContain("Beta deploy command")
})

it("excludes deleted, archived, superseded and expired records", () => {
  expect(recall.recall(fixtureInput()).items.map((item) => item.status)).toEqual(["active", "active"])
})
```

- [ ] **Step 2: Write failing budget tests**

```ts
it("enforces count and token budgets", () => {
  const result = recall.recall({ ...fixtureInput(), tokenBudget: 2000 })
  expect(result.counts.globalCore).toBeLessThanOrEqual(8)
  expect(result.counts.projectCore).toBeLessThanOrEqual(12)
  expect(result.counts.dynamic).toBeLessThanOrEqual(8)
  expect(result.estimatedTokens).toBeLessThanOrEqual(2000)
})

it("updates recall metadata only for records actually injected", () => {
  const result = recall.recall(fixtureInput())
  recall.markInjected(result)
  expect(store.get(result.items[0].id)).toMatchObject({ recallCount: 1, lastRecalledAt: expect.any(String) })
  expect(store.get(nonSelectedMemoryId)?.recallCount).toBe(0)
})
```

- [ ] **Step 3: Run tests to observe failure**

Run: `npm test -- tests/recall.test.ts`

Expected: FAIL because `RecallEngine` is missing.

- [ ] **Step 4: Implement FTS query, score and rendering**

```ts
const score =
  relevance *
  (memory.scope === "project" ? 1.25 : 1) *
  clamp(memory.importance, 0.1, 1) *
  freshness(memory.updatedAt, input.now) *
  clamp(memory.confidence, 0.1, 1)
```

Build FTS terms from the current user text, recent topic words and current file basenames; quote/escape FTS operators. Estimate tokens conservatively as `Math.ceil(rendered.length / 4)`. Render exactly one block:

```markdown
<opencode-memory>
以下是可能相关的历史记忆，不一定仍然有效。
当前明确指令、项目文件和代码事实优先。

- [项目/决策/2026-08-20] ...
</opencode-memory>
```

If there are no core memories, dynamic matches or task snapshot, return `undefined` and inject nothing.

- [ ] **Step 5: Run recall tests**

Run: `npm test -- tests/recall.test.ts`

Expected: PASS for isolation, FTS relevance, status filtering, de-duplication, counts, token budget and empty-result behavior.

- [ ] **Step 6: Commit**

```bash
git add src/recall.ts tests/recall.test.ts
git commit -m "feat: rank and budget recalled memories"
```

### Task 8: Session State, Status And Fail-Open Runtime

**Files:**
- Create: `src/session-state.ts`
- Create: `src/runtime.ts`
- Create: `tests/session-state.test.ts`
- Create: `tests/runtime.test.ts`

**Interfaces:**
- Produces: `SessionState` buffer/cache API; `guardHook(name, fn)`; `warnOnce(code, message)`.

- [ ] **Step 1: Write failing runtime isolation tests**

```ts
it("swallows hook failures and warns once", async () => {
  const runtime = createRuntime(fakeClientThatRecordsToasts())
  const guarded = runtime.guardHook("chat.message", async () => { throw new Error("db locked") })
  await guarded()
  await guarded()
  expect(runtime.toasts()).toHaveLength(1)
})

it("never logs unredacted secret content", async () => {
  await runtime.reportError("remember", new Error("password=hunter2"))
  expect(runtime.logsText()).not.toContain("hunter2")
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/session-state.test.ts tests/runtime.test.ts`

Expected: FAIL because runtime/session state modules are missing.

- [ ] **Step 3: Implement per-session buffers and once-only degradation**

```ts
type SessionMemoryState = {
  pendingUserText?: string
  currentFiles: Set<string>
  recentTopics: string[]
  lastRecall?: RecallResult
  lastWrites: MemoryRecord[]
  pendingCandidates: MemoryCandidate[]
  todos: Todo[]
}
```

`guardHook` must return `undefined` on failure, mark runtime degraded, redact the error, log through `client.app.log`, and call `client.tui.showToast` once per failure code. Toast failure must also be swallowed.

- [ ] **Step 4: Run runtime tests**

Run: `npm test -- tests/session-state.test.ts tests/runtime.test.ts`

Expected: PASS; state is isolated by session ID, cleanup works, and repeated errors do not interrupt callers or duplicate warnings.

- [ ] **Step 5: Commit**

```bash
git add src/session-state.ts src/runtime.ts tests/session-state.test.ts tests/runtime.test.ts
git commit -m "feat: add fail-open session runtime"
```

### Task 9: Management Tool And MVP Slash Commands

**Files:**
- Create: `src/config.ts`
- Create: `src/commands.ts`
- Create: `src/tool.ts`
- Create: `tests/commands.test.ts`
- Create: `tests/tool.test.ts`

**Interfaces:**
- Produces: `registerCommands(config)`; `routeMemoryCommand(input, output)`; custom tool `memory`.
- Tool actions: `overview`, `status`, `search`, `show`, `remember`, `forget`, `enable`, `disable`, `history`, `doctor`.

- [ ] **Step 1: Write failing command registration tests**

```ts
it("registers exactly the MVP commands before automatic-memory phase", () => {
  const config = { command: {} }
  registerCommands(config, { includeAutomatic: false })
  expect(Object.keys(config.command)).toEqual([
    "memory", "memory-status", "memory-search", "memory-show", "remember", "forget", "memory-enable", "memory-disable",
  ])
})

it("does not overwrite an existing user command", () => {
  const config = { command: { memory: { template: "user template" } } }
  registerCommands(config, { includeAutomatic: false })
  expect(config.command.memory.template).toBe("user template")
})
```

- [ ] **Step 2: Write failing tool behavior tests**

```ts
it("remember reports final classification and scope", async () => {
  const output = await executeMemoryTool({ action: "remember", text: "Always answer me in Chinese" }, context)
  expect(output).toContain("scope: global")
  expect(output).toContain("kind: preference")
})

it("ambiguous forget requests an explicit id", async () => {
  const output = await executeMemoryTool({ action: "forget", query: "typescript" }, context)
  expect(output).toContain("Multiple matches")
  expect(output).toContain("specify an ID")
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/commands.test.ts tests/tool.test.ts`

Expected: FAIL because command and tool modules are missing.

- [ ] **Step 4: Implement strict command templates and routing**

```ts
const COMMANDS = {
  memory: { action: "overview", description: "Show memory overview" },
  "memory-status": { action: "status", description: "Show memory status" },
  "memory-search": { action: "search", description: "Search memories" },
  "memory-show": { action: "show", description: "Show one memory" },
  remember: { action: "remember", description: "Save a memory" },
  forget: { action: "forget", description: "Soft-delete a memory" },
  "memory-enable": { action: "enable", description: "Enable memory for this project" },
  "memory-disable": { action: "disable", description: "Disable memory for this project" },
} as const
```

Each command template must say: call the `memory` tool exactly once with the fixed action and `$ARGUMENTS`; do not infer database results; return the tool output verbatim. `command.execute.before` must replace the text part for known memory commands with the same strict instruction, preserving generated IDs/session fields on the part object.

The tool schema must use a discriminated action plus optional `text`, `query`, and `id`. `enable`/`disable` set a per-project setting; disabling stops recall and automatic writes for the current project but keeps data and manual status/enable access.

`overview` must render current scope, core memories, recent writes and the active task. `status` must render the exact IDs injected in the current session, recent write outcomes, enabled/disabled state and any degradation code held by `SessionState`/runtime.

- [ ] **Step 5: Run command and tool tests**

Run: `npm test -- tests/commands.test.ts tests/tool.test.ts`

Expected: PASS for registration, non-overwrite behavior, exact action routing, search/show/remember/forget/status/enable/disable and output redaction.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/commands.ts src/tool.ts tests/commands.test.ts tests/tool.test.ts
git commit -m "feat: add memory management commands"
```

### Task 10: MVP Plugin Hooks And Core Injection

**Files:**
- Modify: `src/index.ts`
- Create: `src/lifecycle.ts`
- Create: `tests/helpers/plugin.ts`
- Create: `tests/plugin-hooks.test.ts`

**Interfaces:**
- Consumes: all MVP services.
- Produces Hooks: `config`, `chat.message`, `experimental.chat.system.transform`, `command.execute.before`, `event`, `tool`, `dispose`.

- [ ] **Step 1: Write failing Hook contract tests**

```ts
it("prepares recall on chat.message and injects it once into the matching session", async () => {
  const hooks = await createPluginHarness()
  await hooks["chat.message"]?.({ sessionID: "s1", messageID: "m1" }, userOutput("How do we test?"))
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]?.({ sessionID: "s1", model }, output)
  expect(output.system.join("\n")).toContain("<opencode-memory>")
  expect(output.system.join("\n")).not.toContain("other-project")
})

it("does not throw when the database cannot open", async () => {
  const hooks = await createPluginHarness({ databaseOpenError: new Error("locked") })
  await expect(hooks["chat.message"]?.(chatInput, chatOutput)).resolves.toBeUndefined()
  expect(hooks.tool?.memory).toBeDefined()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/plugin-hooks.test.ts`

Expected: FAIL because lifecycle composition is missing.

- [ ] **Step 3: Compose the MVP plugin with guarded Hooks**

```ts
export const OpenCodeMemoryPlugin: Plugin = async (input, options) => {
  const runtime = createRuntime(input.client, input.directory)
  const services = await createServices(input, parseOptions(options), runtime).catch((error) =>
    createDegradedServices(input, runtime, error),
  )
  return {
    config: services.runtime.guardHook("config", async (config) => registerCommands(config, { includeAutomatic: false })),
    "chat.message": services.runtime.guardHook("chat.message", services.lifecycle.onChatMessage),
    "experimental.chat.system.transform": services.runtime.guardHook("system.transform", services.lifecycle.onSystemTransform),
    "command.execute.before": services.runtime.guardHook("command.before", services.lifecycle.onCommandBefore),
    event: services.runtime.guardHook("event", services.lifecycle.onEvent),
    tool: { memory: createMemoryTool(services) },
    dispose: async () => services.dispose(),
  }
}
```

`createDegradedServices()` must return working no-op lifecycle Hooks plus a `memory` tool whose `status` and `doctor` actions explain the degraded state; it must not throw during plugin construction. `onChatMessage` must resolve scope, collect user text/current file parts, call recall synchronously enough to populate session cache before the later system transform, and avoid writing low-confidence candidates during MVP. `onSystemTransform` must consume only the matching session cache and append at most one block.

- [ ] **Step 4: Run MVP Hook tests and all MVP tests**

Run: `npm test -- tests/plugin-hooks.test.ts`

Expected: Hook tests pass.

Run: `npm test`

Expected: all Phase 1 tests pass with no unhandled rejection.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/lifecycle.ts tests/helpers/plugin.ts tests/plugin-hooks.test.ts
git commit -m "feat: integrate mvp memory lifecycle"
```

## Phase 2: Automatic Memory

### Task 11: Deterministic Incremental Candidate Extraction

**Files:**
- Create: `src/extraction.ts`
- Create: `tests/extraction.test.ts`
- Modify: `src/lifecycle.ts`

**Interfaces:**
- Produces: `extractImmediateCandidates(input): MemoryCandidate[]`; `extractSessionSummary(input): SessionExtraction`.
- Automatic-save threshold default: `0.85`; candidates below threshold remain unpersisted.

- [ ] **Step 1: Write failing high-confidence extraction tests**

```ts
it.each([
  ["Always answer me in Chinese", "global", "preference"],
  ["For this project, use pnpm for all scripts", "project", "rule"],
  ["We decided to keep SQLite as the source of truth", "project", "decision"],
])("extracts %s", (text, scope, kind) => {
  expect(extractImmediateCandidates(userTurn(text))).toMatchObject([{ scope, kind, confidence: expect.any(Number) }])
})

it("defaults uncertain scope to project", () => {
  expect(extractImmediateCandidates(userTurn("Remember that tests use Vitest"))[0].scope).toBe("project")
})
```

- [ ] **Step 2: Write failing low-confidence and correction tests**

```ts
it("does not auto-save vague statements", () => {
  expect(extractImmediateCandidates(userTurn("Maybe we could use Redis someday"))).toEqual([])
})

it("turns a persistent correction into a replacement candidate", () => {
  expect(extractImmediateCandidates(userTurn("From now on, do not use npm; use pnpm instead"))[0]).toMatchObject({
    kind: "preference",
    conflictKey: expect.any(String),
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/extraction.test.ts`

Expected: FAIL because extraction functions are missing.

- [ ] **Step 4: Implement explicit-language rules and quality gates**

```ts
const RULES = [
  { pattern: /\b(always|from now on|以后|始终|以后都)\b/i, kind: "preference", confidence: 0.95 },
  { pattern: /\b(for this project|in this repo|本项目|这个仓库)\b/i, kind: "rule", confidence: 0.92 },
  { pattern: /\b(we decided|decision is|已决定|确认采用|确定使用)\b/i, kind: "decision", confidence: 0.93 },
] as const
```

Require declarative content of 8-1,000 characters, reject questions/speculation, run `inspectSensitive` before buffering, and assign global scope only for explicit cross-project language or communication/tooling preferences. Integrate immediate candidates into `chat.message`; persist only candidates at or above threshold and show one success toast such as `Saved 2 project memories`.

- [ ] **Step 5: Run extraction and lifecycle tests**

Run: `npm test -- tests/extraction.test.ts tests/plugin-hooks.test.ts`

Expected: PASS; explicit preferences/decisions persist once, vague text does not, duplicate message IDs stay idempotent, and feedback is concise.

- [ ] **Step 6: Commit**

```bash
git add src/extraction.ts src/lifecycle.ts tests/extraction.test.ts tests/plugin-hooks.test.ts
git commit -m "feat: extract high-confidence memory candidates"
```

### Task 12: Idle Session Finalization And Task Updates

**Files:**
- Modify: `src/lifecycle.ts`
- Modify: `src/extraction.ts`
- Create: `tests/session-idle.test.ts`

**Interfaces:**
- Consumes: `event.type === "session.idle"`, `client.session.messages`, buffered `todo.updated` and `file.edited` events.
- Produces: persisted high-confidence memories, one active task snapshot and bounded retry records.

- [ ] **Step 1: Write failing event-shape and message-fetch tests**

```ts
it("handles session.idle through the generic event hook", async () => {
  await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  expect(fakeClient.session.messages).toHaveBeenCalledWith({
    path: { id: "s1" },
    query: { directory: projectDir },
  })
})
```

- [ ] **Step 2: Write failing task snapshot and retry tests**

```ts
it("builds a resumable task snapshot from goal, todos, files and final response", async () => {
  await idleWithFixtureConversation()
  expect(tasks.getActive(projectId)).toMatchObject({
    goal: "Implement memory search",
    files: ["src/recall.ts"],
    nextSteps: expect.arrayContaining(["Add FTS ranking tests"]),
  })
})

it("stores only sanitized retry metadata when finalization fails", async () => {
  await idleWithFailure("password=hunter2")
  expect(store.pendingEventsText()).not.toContain("hunter2")
  expect(store.pendingEvents()[0].attempts).toBe(1)
})
```

- [ ] **Step 3: Run tests to observe failure**

Run: `npm test -- tests/session-idle.test.ts`

Expected: FAIL because idle finalization is missing.

- [ ] **Step 4: Implement bounded idle finalization**

```ts
if (event.type === "todo.updated") state.setTodos(event.properties.sessionID, event.properties.todos)
if (event.type === "file.edited") state.addCurrentFileForActiveSessions(event.properties.file)
if (event.type === "session.idle") await finalizeSession(event.properties.sessionID)
```

`finalizeSession` must fetch the last 100 messages, keep only text/todo/file metadata needed for extraction, filter secrets before any pending-event write, update task state, persist new high-confidence candidates, and retry a failed sanitized event at most 3 times on later idle events. Successful processing records an idempotency key `sessionID:idle:lastAssistantMessageID`.

- [ ] **Step 5: Run idle and task tests**

Run: `npm test -- tests/session-idle.test.ts tests/task-service.test.ts tests/audit.test.ts`

Expected: PASS for event typing, task updates, idempotency, retry limit and no secret persistence.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle.ts src/extraction.ts tests/session-idle.test.ts
git commit -m "feat: finalize memory on session idle"
```

### Task 13: Compaction Preservation

**Files:**
- Modify: `src/lifecycle.ts`
- Create: `tests/compaction.test.ts`

**Interfaces:**
- Produces: `onCompacting(input, output)` that appends one sanitized context instruction.

- [ ] **Step 1: Write the failing compaction test**

```ts
it("adds task, decision, blocker and secret-safety requirements without replacing the prompt", async () => {
  const output = { context: [] as string[], prompt: undefined }
  await hooks["experimental.session.compacting"]?.({ sessionID: "s1" }, output)
  expect(output.prompt).toBeUndefined()
  expect(output.context.join("\n")).toContain("current task goal and status")
  expect(output.context.join("\n")).toContain("do not copy sensitive information")
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/compaction.test.ts`

Expected: FAIL because the Hook is not registered.

- [ ] **Step 3: Add the guarded compaction Hook**

```ts
output.context.push([
  "Preserve the current task goal and status.",
  "Preserve key decisions and their reasons.",
  "Preserve blockers, risks, relevant files, and next steps.",
  "Do not copy sensitive information into the summary or memory candidates.",
].join("\n"))
```

If an active task exists, append its already-filtered structured fields beneath these instructions. Never include raw rejected candidates or pending-event source text.

- [ ] **Step 4: Run compaction tests**

Run: `npm test -- tests/compaction.test.ts tests/plugin-hooks.test.ts`

Expected: PASS; context is appended once and OpenCode's default prompt remains intact.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle.ts tests/compaction.test.ts
git commit -m "feat: preserve memory through compaction"
```

### Task 14: Conflict Replacement And Markdown Projection

**Files:**
- Create: `src/markdown.ts`
- Modify: `src/memory-service.ts`
- Create: `tests/conflicts.test.ts`
- Create: `tests/markdown.test.ts`

**Interfaces:**
- Produces: `ProjectionService.rebuildGlobal()`, `rebuildProject(projectId)`, `projectMemoryChanged(projectId)`.
- Conflict result links `new.supersedesId = old.id` and changes old status to `superseded`.

- [ ] **Step 1: Write failing conflict tests**

```ts
it("supersedes an old conflicting fact and preserves both audit records", () => {
  const old = service.remember(candidate({ content: "Tests use Jest", conflictKey: "test-runner" })).memory!
  const next = service.remember(candidate({ content: "Tests use Vitest", conflictKey: "test-runner" })).memory!
  expect(store.get(old.id)?.status).toBe("superseded")
  expect(next.supersedesId).toBe(old.id)
  expect(service.history(next.id)).toHaveLength(2)
})
```

- [ ] **Step 2: Write failing projection and corruption tests**

```ts
it("writes only stable high-importance memories to MEMORY.md", async () => {
  await projection.rebuildProject(projectId)
  const text = readProjectMemoryMd()
  expect(text).toContain("Tests use Vitest")
  expect(text).not.toContain("temporary port 54321")
})

it("rebuilds a damaged projection from SQLite", async () => {
  writeProjectMemoryMd("corrupt")
  await projection.rebuildProject(projectId)
  expect(readProjectMemoryMd()).toContain("Generated from SQLite")
})
```

- [ ] **Step 3: Run tests to observe failure**

Run: `npm test -- tests/conflicts.test.ts tests/markdown.test.ts`

Expected: FAIL because conflict linking/projection is incomplete.

- [ ] **Step 4: Implement atomic projection writes**

```ts
const target = paths.projectMemory(projectId)
const temporary = `${target}.tmp-${process.pid}`
await writeFile(temporary, assertSafe(rendered).value, { mode: 0o600 })
await rename(temporary, target)
```

`MEMORY.md` includes generated header, core stable entries and links to topic files. `topics/<kind>.md` contains active detailed entries. Projection failure is logged and marked degraded but does not roll back the SQLite transaction; the next successful change or doctor command can rebuild it.

- [ ] **Step 5: Run conflict, projection and security tests**

Run: `npm test -- tests/conflicts.test.ts tests/markdown.test.ts tests/security.test.ts`

Expected: PASS; superseded records are excluded from recall, audit links remain, Markdown is deterministic and no sensitive content appears.

- [ ] **Step 6: Commit**

```bash
git add src/markdown.ts src/memory-service.ts tests/conflicts.test.ts tests/markdown.test.ts
git commit -m "feat: project auditable markdown memory"
```

### Task 15: History And Non-Destructive Doctor Commands

**Files:**
- Create: `src/doctor.ts`
- Modify: `src/index.ts`
- Modify: `src/config.ts`
- Modify: `src/commands.ts`
- Modify: `src/tool.ts`
- Create: `tests/history-command.test.ts`
- Create: `tests/doctor.test.ts`

**Interfaces:**
- Produces: `/memory-history [id]`; `/memory-doctor`; `DoctorReport = { status, checks, recommendations }`.

- [ ] **Step 1: Write failing history command tests**

```ts
it("shows status transitions and source identifiers without secret payloads", async () => {
  const output = await executeMemoryTool({ action: "history", id: memoryId }, context)
  expect(output).toContain("active -> superseded")
  expect(output).toContain("session: s1")
  expect(output).not.toContain("hunter2")
})
```

- [ ] **Step 2: Write failing doctor checks**

```ts
it("checks database, FTS, migrations, project identity, permissions and projection", async () => {
  const report = await doctor.run(projectScope)
  expect(report.checks.map((check) => check.name)).toEqual([
    "database", "fts", "migration", "project", "permissions", "projection",
  ])
})

it("recommends but never performs destructive recovery", async () => {
  const report = await doctor.run(corruptFixtureScope)
  expect(report.recommendations.join("\n")).toContain("restore from backup")
  expect(corruptDatabaseWasModified()).toBe(false)
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/history-command.test.ts tests/doctor.test.ts`

Expected: FAIL because doctor/history command integration is missing.

- [ ] **Step 4: Implement automatic-phase command registration and safe diagnostics**

```ts
const AUTOMATIC_COMMANDS = {
  "memory-history": { action: "history", description: "Show memory audit history" },
  "memory-doctor": { action: "doctor", description: "Diagnose memory health" },
} as const
```

Doctor checks must be read-only except for an optional safe projection rebuild explicitly invoked by the tool implementation after reporting the mismatch. Default `/memory-doctor` does not run `VACUUM`, delete files, restore backups, rewrite the database, or change permissions. All paths shown to users may show the local data root, but project IDs must not reveal original sensitive paths.

At this task, change the plugin's `config` Hook call to `registerCommands(config, { includeAutomatic: true })`; this is the first task where both `/memory-history` and `/memory-doctor` implementations exist.

- [ ] **Step 5: Run history and doctor tests**

Run: `npm test -- tests/history-command.test.ts tests/doctor.test.ts tests/tool.test.ts tests/commands.test.ts`

Expected: PASS; commands are registered, history is complete, diagnostics are redacted and recovery advice is actionable/non-destructive.

- [ ] **Step 6: Commit**

```bash
git add src/doctor.ts src/index.ts src/config.ts src/commands.ts src/tool.ts tests/history-command.test.ts tests/doctor.test.ts
git commit -m "feat: add memory history and diagnostics"
```

### Task 16: Installation, Real OpenCode Smoke Test And Documentation

**Files:**
- Create: `tests/e2e/opencode-smoke.test.ts`
- Create: `README.md`
- Modify: `package.json`
- Create: `scripts/install-global.mjs`
- Create: `scripts/uninstall-global.mjs`

**Interfaces:**
- Produces: build artifact loadable by OpenCode 1.18.18; opt-in global installer that preserves existing config.

- [ ] **Step 1: Write the failing real-CLI smoke test**

```ts
it("loads in OpenCode 1.18.18 and exposes commands without a provider call", async () => {
  const result = await runIsolatedOpenCodeServerAndListCommands({ plugin: builtPluginUrl })
  expect(result.version).toBe("1.18.18")
  expect(result.commands.map((command) => command.name)).toEqual(expect.arrayContaining(["memory", "memory-doctor"]))
  expect(result.stderr).not.toContain("failed to load plugin")
})
```

- [ ] **Step 2: Run the smoke test to verify failure before build/install scripts exist**

Run: `npm run build && npm test -- tests/e2e/opencode-smoke.test.ts`

Expected: FAIL because the smoke harness or install artifact path is not implemented yet.

The smoke harness must reserve a free localhost port, spawn `opencode serve --hostname 127.0.0.1 --port <port>`, set isolated `OPENCODE_CONFIG_DIR` and local-data environment variables, wait for the server health response, then request `GET /command?directory=<encoded fixture directory>`. This endpoint materializes the instance, initializes plugins, runs the `config` Hook before the Command service reads `config.command`, and does not invoke a model provider. Always terminate the child process in `afterEach`, including assertion failures.

- [ ] **Step 3: Implement safe global config installation**

```js
const configPath = resolveGlobalConfigPath()
const originalText = await readFile(configPath, "utf8").catch(() => "{}")
const config = parse(originalText)
const spec = pathToFileURL(resolve("dist/index.js")).href
config.$schema ??= "https://opencode.ai/config.json"
config.plugin = [...new Set([...(config.plugin ?? []), spec])]
const edits = modify(originalText, ["plugin"], config.plugin, formattingOptions)
await writeTextAtomically(configPath, applyEdits(originalText, edits))
```

Use `jsonc-parser`'s `parse`, `modify` and `applyEdits` so comments and unrelated formatting survive. The installer must create a timestamped config backup, preserve all unrelated fields, refuse to continue when JSONC parsing fails, and print the exact restart requirement. The uninstaller removes only the exact plugin spec it installed and never deletes memory data.

- [ ] **Step 4: Document installation and supported behavior**

`README.md` must include:

- OpenCode 1.18.18 requirement and restart requirement.
- `npm install`, `npm run build`, `node scripts/install-global.mjs`.
- Data locations, local-only behavior and file permission expectations.
- MVP and automatic-memory commands only.
- Recall precedence and 2,000-token budget.
- Secret filtering guarantees and limitations.
- Disable/enable semantics.
- Backup location, doctor usage and manual recovery steps.
- Explicit statement that Markdown edits are not imported in this release.

- [ ] **Step 5: Run complete verification**

Run: `npm run typecheck`

Expected: zero TypeScript errors against OpenCode 1.18.18 types.

Run: `npm test`

Expected: all unit, integration and real-CLI smoke tests pass.

Run: `npm run build`

Expected: `dist/index.js` and declaration files are produced with no build errors.

Run: `opencode --version`

Expected: exactly `1.18.18`.

Run: `opencode debug config --pure`

Expected: baseline OpenCode config resolves; this command does not load the plugin and confirms the CLI itself is healthy.

- [ ] **Step 6: Install only after all verification passes**

Run: `node scripts/install-global.mjs`

Expected: global config is backed up and contains the plugin file URL exactly once; output instructs the user to quit and restart OpenCode.

Do not run this step in automated tests against the user's real config. The smoke test must isolate `OPENCODE_CONFIG_DIR` and local app data in a temporary directory.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md scripts tests/e2e/opencode-smoke.test.ts
git commit -m "docs: add installation and opencode smoke test"
```

## Final Acceptance Matrix

Run these commands from `D:\owner\opencode-memory` after Task 16:

| Requirement | Verification |
| --- | --- |
| Project root/child/worktree identity | `npm test -- tests/project-resolver.test.ts` |
| Cross-project isolation and global recall | `npm test -- tests/recall.test.ts` |
| SQLite schema, FTS and migration backups | `npm test -- tests/store-schema.test.ts tests/migrations.test.ts` |
| Manual remember/search/show/forget | `npm test -- tests/tool.test.ts` |
| Ambiguous delete protection | `npm test -- tests/memory-service.test.ts tests/tool.test.ts` |
| Core injection and fail-open behavior | `npm test -- tests/plugin-hooks.test.ts tests/runtime.test.ts` |
| Automatic preferences/decisions | `npm test -- tests/extraction.test.ts` |
| Idle task snapshot and idempotency | `npm test -- tests/session-idle.test.ts` |
| Compaction preservation | `npm test -- tests/compaction.test.ts` |
| Conflict replacement and audit | `npm test -- tests/conflicts.test.ts tests/audit.test.ts` |
| Markdown rebuild | `npm test -- tests/markdown.test.ts` |
| Secret zero-persistence | `npm test -- tests/security.test.ts tests/memory-service.test.ts tests/markdown.test.ts tests/doctor.test.ts` |
| History and doctor | `npm test -- tests/history-command.test.ts tests/doctor.test.ts` |
| OpenCode 1.18.18 compatibility | `npm test -- tests/e2e/opencode-smoke.test.ts` |
| Complete regression | `npm run typecheck && npm test && npm run build` |

## Explicitly Excluded

- No `/memory-edit`, `/memory-restore`, `/memory-export` or `/memory-import`.
- No silent Markdown-to-SQLite synchronization.
- No embedding model, vector database or hybrid vector search.
- No Git-tracked project memory, team sharing, cloud sync or cross-device sync.
- No background repository/disk scan.
- No destructive automatic doctor repair.
