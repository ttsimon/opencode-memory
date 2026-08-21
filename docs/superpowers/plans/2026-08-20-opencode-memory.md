# OpenCode Memory MVP And Automatic Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成工程治理的仓库中实现 OpenCode Memory 的 MVP 与自动记忆阶段，提供纯本地、可审计、可降级的跨会话记忆、项目规则和任务续接能力。

**Architecture:** 使用 `bun:sqlite` 作为唯一事实源，领域层通过 repository 接口访问存储，Markdown 仅为可重建投影。OpenCode 适配集中在 `src/plugin/`，召回通过 `chat.message` 准备并由 `experimental.chat.system.transform` 注入，`session.idle` 通过通用 `event` Hook 处理，所有 Hook 使用 fail-open 运行时包装。

**Tech Stack:** mise、Bun 1.3.14、TypeScript 5.8.2、`bun:test`、`bun:sqlite`、Zod 4.1.8、OpenCode / `@opencode-ai/plugin` / `@opencode-ai/sdk` 1.18.18、Biome 2.5.9。

## Global Constraints

- 产品范围以 `docs/2026-08-20-opencode-memory-design.md` 为准，只实现 MVP 与“自动记忆”；不实现 `/memory-edit`、`/memory-restore`、`/memory-export`、`/memory-import`、向量检索、Git 团队记忆或云同步。
- 工程规范以 `docs/superpowers/specs/2026-08-20-repository-engineering-standards-design.md` 为准。
- Bun 精确固定 `1.3.14`；OpenCode、plugin 和 SDK 精确固定 `1.18.18`。
- 使用 `bun:test` 和 `bun:sqlite`；不引入 Vitest、Jest、`better-sqlite3` 或外部数据库 ORM。
- 所有新行为遵循 RED-GREEN-REFACTOR；Bug 修复必须先有可复现回归测试。
- SQLite 是记忆、任务快照和审计的唯一事实源；Markdown 是可重建投影。
- 敏感过滤必须发生在数据库、Markdown、日志、备份和诊断写入之前；拒绝记录不得包含原文、哈希或可逆摘要。
- 当前用户指令和当前仓库事实高于历史记忆；注入文本必须包含该优先级提示。
- 默认召回上限：全局核心 8、项目核心 12、动态记忆 8、活动任务 1，总预算约 2,000 Token。
- 插件故障不得阻断 OpenCode 对话、命令或工具；同类故障每个插件实例只显示一次非阻断警告。
- 不修改用户真实 OpenCode 全局配置；E2E 继续使用 `tests/helpers/opencode-server.ts` 的隔离环境。
- 每个用户可见 PR 必须包含 changeset；MVP 和自动记忆各生成一个真实 changeset，不为内部任务创建空 changeset。每个任务结束运行 focused tests，阶段结束运行 `bun run check` 和 `bun run test:e2e`。

---

## Verified OpenCode 1.18.18 Contracts

- Plugin：`(input: PluginInput, options?) => Promise<Hooks>`。
- `chat.message`：输入含 `sessionID`/`messageID?`，输出含 `message` 和 `parts`；在用户消息保存前触发。
- `experimental.chat.system.transform`：输入含 `sessionID?`，向 `output.system: string[]` 追加上下文。
- `experimental.chat.messages.transform` 无 `sessionID`，且 compaction 也会调用；不得用于主召回注入。
- `session.idle` 是 `event({ event })` 中的事件：`{ type: "session.idle", properties: { sessionID } }`。
- `experimental.session.compacting`：向 `output.context` 追加内容，不替换默认 prompt。
- `command.execute.before` 只能修改 `output.parts`，不能短路命令或直接返回数据库结果。
- 自定义命令由 `config.command` 注册，模板强制调用插件 `memory` 工具并逐字返回工具结果。
- 会话收尾读取：`client.session.messages({ path: { id }, query: { directory } })`。
- 非阻断反馈：`client.tui.showToast(...)`；结构化日志：`client.app.log(...)`。

## Planned Source Layout

```text
src/index.ts
src/domain/types.ts
src/domain/classification.ts
src/paths.ts
src/project/resolver.ts
src/security/filter.ts
src/security/redaction.ts
src/storage/database.ts
src/storage/migrations.ts
src/storage/memory-repository.ts
src/storage/task-repository.ts
src/storage/audit-repository.ts
src/memory-service.ts
src/task-service.ts
src/recall/engine.ts
src/recall/render.ts
src/plugin/runtime.ts
src/plugin/session-state.ts
src/plugin/commands.ts
src/plugin/tool.ts
src/plugin/hooks.ts
src/lifecycle/extraction.ts
src/lifecycle/finalization.ts
src/projection/markdown.ts
src/diagnostics/doctor.ts
tests/helpers/database.ts
tests/helpers/git.ts
tests/helpers/plugin.ts
tests/unit/**
tests/integration/**
tests/e2e/**
```

## Phase 1: MVP

### Task 1: Domain Model, Data Paths And Project Identity

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/paths.ts`
- Create: `src/project/resolver.ts`
- Create: `tests/helpers/git.ts`
- Create: `tests/unit/paths.test.ts`
- Create: `tests/integration/project-resolver.test.ts`

**Interfaces:**
- Produces `MemoryScope`, `MemoryKind`, `MemoryStatus`, `MemoryRecord`, `MemoryCandidate`, `ProjectScope`, `DataPaths`.
- Produces `resolveDataPaths(env, platform): DataPaths` and `resolveProject({ directory, worktree }): Promise<ProjectScope>`.

- [ ] **Step 1: Write failing path and project tests**

```ts
test("uses LOCALAPPDATA and never the repository on Windows", () => {
  const paths = resolveDataPaths({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32")
  expect(paths.root).toBe("C:\\Users\\me\\AppData\\Local\\opencode-memory")
  expect(paths.database).toBe(`${paths.root}\\memory.db`)
})

test("root, child and linked worktree share one project id", async () => {
  const fixture = await createGitWorktreeFixture()
  const scopes = await Promise.all([
    resolveProject({ directory: fixture.root, worktree: fixture.root }),
    resolveProject({ directory: fixture.child, worktree: fixture.root }),
    resolveProject({ directory: fixture.linked, worktree: fixture.linked }),
  ])
  expect(new Set(scopes.map((scope) => scope.projectId)).size).toBe(1)
  expect(scopes[0]?.projectId).toMatch(/^[a-f0-9]{32}$/)
  expect(scopes[0]?.projectId).not.toContain(fixture.root)
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/paths.test.ts tests/integration/project-resolver.test.ts`

Expected: FAIL because `resolveDataPaths` and `resolveProject` do not exist.

- [ ] **Step 3: Implement normalized identities and owner-local paths**

```ts
export interface ProjectScope {
  readonly projectId: string
  readonly root: string
  readonly identity: string
  readonly kind: "git" | "path"
}

export async function resolveProject(input: { directory: string; worktree: string }): Promise<ProjectScope> {
  const commonDirectory = await readGitCommonDirectory(input.directory)
  const root = commonDirectory ? await canonicalRepositoryRoot(commonDirectory) : await realpath(input.directory)
  const identity = `${commonDirectory ? "git" : "path"}:${normalizeIdentityPath(root)}`
  return {
    projectId: new Bun.CryptoHasher("sha256").update(identity).digest("hex").slice(0, 32),
    root,
    identity,
    kind: commonDirectory ? "git" : "path",
  }
}
```

Use `git rev-parse --path-format=absolute --git-common-dir`; on non-zero exit use canonical absolute path. Create data directories with mode `0o700` where supported.

Path policy: Windows uses `%LOCALAPPDATA%/opencode-memory`; macOS uses `$HOME/Library/Application Support/opencode-memory`; Linux uses `$XDG_DATA_HOME/opencode-memory` or `$HOME/.local/share/opencode-memory` when XDG is unset. Add one unit test for each branch.

- [ ] **Step 4: Verify GREEN**

Run: `bun test tests/unit/paths.test.ts tests/integration/project-resolver.test.ts`

Expected: PASS for Git root/child/worktree, different repositories, non-Git stability and hidden path IDs.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: resolve memory data and project scopes"
```

### Task 2: Sensitive Information Boundary

**Files:**
- Create: `src/security/filter.ts`
- Create: `src/security/redaction.ts`
- Create: `tests/unit/security.test.ts`

**Interfaces:**
- Produces `inspectSensitive(text): SensitiveInspection` and `redactDiagnostic(text): string`.

- [ ] **Step 1: Write failing table-driven tests**

```ts
test.each([
  ["sk-proj-abcdefghijklmnopqrstuvwxyz123456", "api_key"],
  ["password=hunter2", "password"],
  ["-----BEGIN PRIVATE KEY-----\nabc", "private_key"],
  ["postgres://alice:secret@db.example/app", "connection_credential"],
  ["AWS_SECRET_ACCESS_KEY=abc123xyz", "env_secret"],
])("rejects %s", (text, reason) => {
  expect(inspectSensitive(text)).toEqual({ safe: false, reasons: [reason] })
  expect(JSON.stringify(inspectSensitive(text))).not.toContain(text)
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/security.test.ts`

Expected: FAIL because security functions are missing.

- [ ] **Step 3: Implement ordered detection and irreversible diagnostics**

```ts
const rules: ReadonlyArray<{ readonly reason: SensitiveReason; readonly pattern: RegExp }> = [
  { reason: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { reason: "connection_credential", pattern: /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s:/]+:[^\s@]+@/i },
  { reason: "api_key", pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/ },
  { reason: "password", pattern: /\b(?:password|passwd|pwd|cookie|authorization)\s*[:=]\s*\S+/i },
  { reason: "env_secret", pattern: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/i },
]
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `bun test tests/unit/security.test.ts && bun run check`

Expected: all security samples and benign controls pass; no rejected source appears in serialized results.

```bash
git add src/security tests/unit/security.test.ts
git commit -m "feat: reject sensitive memory content"
```

### Task 3: SQLite Schema, FTS And Migration Backups

**Files:**
- Create: `src/storage/database.ts`
- Create: `src/storage/migrations.ts`
- Create: `tests/helpers/database.ts`
- Create: `tests/integration/database.test.ts`
- Create: `tests/integration/migrations.test.ts`

**Interfaces:**
- Produces `openDatabase(paths): MemoryDatabase` backed by `bun:sqlite`.
- Tables: `schema_migrations`, `memories`, `memory_fts`, `task_snapshots`, `audit_events`, `processed_events`, `settings`, `pending_events`.

- [ ] **Step 1: Write failing schema and backup tests**

```ts
test("creates schema version 1 and FTS triggers", () => {
  using fixture = createDatabaseFixture()
  expect(fixture.database.schemaVersion()).toBe(1)
  expect(fixture.database.tableNames()).toContain("memory_fts")
})

test("migration failure keeps a restorable pre-migration backup", () => {
  const fixture = createFailingMigrationFixture()
  expect(() => openDatabase(fixture.paths)).toThrow(/migration/i)
  expect(fixture.openLatestBackup().query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/integration/database.test.ts tests/integration/migrations.test.ts`

Expected: FAIL because the database layer is missing.

- [ ] **Step 3: Implement migration 1 and transaction boundaries**

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
CREATE VIRTUAL TABLE memory_fts USING fts5(content, kind, scope, project_id UNINDEXED, content='memories', content_rowid='rowid');
```

Create insert/update/delete FTS triggers. Before migrating an existing database, checkpoint WAL, copy to `backups/memory-v<old>-<timestamp>.db`, and keep newest 3.

- [ ] **Step 4: Verify GREEN and commit**

Run: `bun test tests/integration/database.test.ts tests/integration/migrations.test.ts`

Expected: schema/FTS/rollback/backup retention tests pass.

```bash
git add src/storage tests/helpers/database.ts tests/integration
git commit -m "feat: add local SQLite memory schema"
```

### Task 4: Repositories, Manual Classification And Audit Pipeline

**Files:**
- Create: `src/storage/memory-repository.ts`
- Create: `src/storage/task-repository.ts`
- Create: `src/storage/audit-repository.ts`
- Create: `src/domain/classification.ts`
- Create: `src/memory-service.ts`
- Create: `src/task-service.ts`
- Create: `tests/unit/classification.test.ts`
- Create: `tests/integration/memory-service.test.ts`
- Create: `tests/integration/task-service.test.ts`

**Interfaces:**
- Produces `classifyManualMemory(text, projectId): MemoryCandidate`.
- Produces `MemoryService.remember/search/get/forget/history` and `TaskService.getActive/replace/archive`.

- [ ] **Step 1: Write failing write, idempotency and task tests**

```ts
test("manual remember classifies scope and writes one audit event", () => {
  const result = service.remember(classifyManualMemory("Always answer me in Chinese", projectId))
  expect(result).toMatchObject({ outcome: "created", memory: { scope: "global", kind: "preference" } })
  expect(audit.list()).toHaveLength(1)
})

test("same source event is idempotent", () => {
  service.remember(candidate({ sourceSessionId: "s1", sourceMessageId: "m1" }))
  service.remember(candidate({ sourceSessionId: "s1", sourceMessageId: "m1" }))
  expect(memories.count()).toBe(1)
})

test("a new unrelated task archives the previous active task", () => {
  tasks.replace(snapshot({ goal: "Add search" }))
  tasks.replace(snapshot({ goal: "Fix login" }))
  expect(tasks.list(projectId).map((item) => item.status)).toEqual(["archived", "active"])
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/classification.test.ts tests/integration/memory-service.test.ts tests/integration/task-service.test.ts`

Expected: FAIL because repositories/services are missing.

- [ ] **Step 3: Implement security-first transactional writes**

```ts
remember(candidate: MemoryCandidate): RememberResult {
  const safety = inspectSensitive(candidate.content)
  if (!safety.safe) return this.auditRejected(candidate, safety.reasons)
  return this.database.transaction(() => {
    const duplicate = this.memories.findDuplicate(candidate)
    if (duplicate) return this.updateDuplicate(duplicate, candidate)
    const created = this.memories.insert(candidate)
    this.audit.created(created)
    return { outcome: "created", memory: created }
  })()
}
```

`forget({ query })` only deletes when exactly one active result matches; multiple results return IDs without deletion. Manual `/remember` confidence is 1.0 but cannot bypass sensitive filtering.

- [ ] **Step 4: Verify GREEN and commit**

Run: `bun test tests/unit/classification.test.ts tests/integration/memory-service.test.ts tests/integration/task-service.test.ts`

Expected: create/update/idempotency/soft-delete/ambiguous-delete/task/audit tests pass; database dump contains no rejected source.

```bash
git add src tests
git commit -m "feat: add auditable memory services"
```

### Task 5: FTS Recall, Ranking And Context Rendering

**Files:**
- Create: `src/recall/engine.ts`
- Create: `src/recall/render.ts`
- Create: `tests/unit/recall-render.test.ts`
- Create: `tests/integration/recall-engine.test.ts`

**Interfaces:**
- Produces `RecallEngine.recall(input): RecallResult`, `markInjected(result)`, and `renderRecall(result): string | undefined`.

- [ ] **Step 1: Write failing isolation and budget tests**

```ts
test("recalls global preferences and only current-project memories", () => {
  const result = recall.recall(query({ projectId: "alpha", text: "How do we run tests?" }))
  expect(result.items.map((item) => item.content)).toContain("Use Chinese for replies")
  expect(result.items.map((item) => item.content)).toContain("Run bun test")
  expect(result.items.map((item) => item.content)).not.toContain("Beta deploy command")
})

test("enforces item and 2000-token budgets", () => {
  const result = recall.recall(query({ tokenBudget: 2_000 }))
  expect(result.counts).toEqual(expect.objectContaining({ task: expect.any(Number) }))
  expect(result.counts.globalCore).toBeLessThanOrEqual(8)
  expect(result.counts.projectCore).toBeLessThanOrEqual(12)
  expect(result.counts.dynamic).toBeLessThanOrEqual(8)
  expect(result.estimatedTokens).toBeLessThanOrEqual(2_000)
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/recall-render.test.ts tests/integration/recall-engine.test.ts`

Expected: FAIL because recall modules are missing.

- [ ] **Step 3: Implement escaped FTS, ranking and exact wrapper**

```ts
const score =
  relevance *
  (memory.scope === "project" ? 1.25 : 1) *
  clamp(memory.importance, 0.1, 1) *
  freshness(memory.updatedAt, input.now) *
  clamp(memory.confidence, 0.1, 1)
```

Estimate tokens with `Math.ceil(rendered.length / 4)`. Exclude deleted, archived, superseded and expired records. Render `<opencode-memory>` with scope/kind/date and the current-facts priority warning. Return `undefined` when there is nothing to inject.

- [ ] **Step 4: Verify GREEN and commit**

Run: `bun test tests/unit/recall-render.test.ts tests/integration/recall-engine.test.ts`

Expected: FTS relevance, scope isolation, status filtering, dedupe, count/token budgets and recall metadata tests pass.

```bash
git add src/recall tests
git commit -m "feat: rank and render recalled memory"
```

### Task 6: Fail-Open Runtime And Per-Session State

**Files:**
- Create: `src/plugin/runtime.ts`
- Create: `src/plugin/session-state.ts`
- Create: `tests/helpers/plugin.ts`
- Create: `tests/unit/runtime.test.ts`
- Create: `tests/unit/session-state.test.ts`

**Interfaces:**
- Produces `PluginRuntime.guardHook`, `reportError`, `warnOnce`; `SessionState` cache/buffer API.

- [ ] **Step 1: Write failing isolation tests**

```ts
test("hook errors are swallowed and warned once", async () => {
  const runtime = createRuntime(fakeClient())
  const guarded = runtime.guardHook("chat.message", async () => { throw new Error("db locked") })
  await guarded()
  await guarded()
  expect(runtime.recordedToasts()).toHaveLength(1)
})

test("session state does not leak recall between sessions", () => {
  state.setRecall("s1", recallResult("alpha"))
  expect(state.consumeRecall("s2")).toBeUndefined()
})
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Run: `bun test tests/unit/runtime.test.ts tests/unit/session-state.test.ts`

Expected RED: modules missing. After implementation, errors are redacted, toast/log failures are swallowed, warnings deduplicate, session cleanup works.

```bash
git add src/plugin tests
git commit -m "feat: add fail-open plugin runtime"
```

### Task 7: MVP Tool, Slash Commands And Hook Integration

**Files:**
- Create: `src/plugin/commands.ts`
- Create: `src/plugin/tool.ts`
- Create: `src/plugin/hooks.ts`
- Modify: `src/index.ts`
- Modify: `tests/unit/plugin-contract.test.ts`
- Create: `tests/unit/commands.test.ts`
- Create: `tests/integration/plugin-hooks.test.ts`
- Modify: `tests/e2e/opencode-smoke.test.ts`

**Interfaces:**
- Commands: `/memory`, `/memory-status`, `/memory-search`, `/memory-show`, `/remember`, `/forget`, `/memory-enable`, `/memory-disable`.
- Tool actions: `health`, `overview`, `status`, `search`, `show`, `remember`, `forget`, `enable`, `disable`.
- Produces `createServices(input: PluginInput, options: unknown, runtime: PluginRuntime): Promise<PluginServices>`, `createDegradedServices(runtime: PluginRuntime, error: unknown): PluginServices`, `createHooks(services: PluginServices): Hooks`.

- [ ] **Step 1: Write failing command/tool/Hook tests**

```ts
test("registers exactly the MVP commands without overwriting user commands", async () => {
  const config = { command: { memory: { template: "user template" } } }
  await hooks.config?.(config)
  expect(config.command.memory.template).toBe("user template")
  expect(Object.keys(config.command)).toEqual(expect.arrayContaining(["remember", "forget", "memory-status"]))
})

test("prepares recall on chat.message and injects it into the matching session", async () => {
  await hooks["chat.message"]?.({ sessionID: "s1", messageID: "m1" }, userOutput("How do we test?"))
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]?.({ sessionID: "s1", model }, output)
  expect(output.system.join("\n")).toContain("<opencode-memory>")
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/commands.test.ts tests/integration/plugin-hooks.test.ts tests/unit/plugin-contract.test.ts`

Expected: FAIL because commands and lifecycle composition are missing.

- [ ] **Step 3: Implement strict command routing and degraded construction**

Each command template instructs the model to call `memory` exactly once with a fixed action and `$ARGUMENTS`, infer nothing, and return tool output verbatim. `command.execute.before` replaces known command text with the same instruction.

```ts
export const OpenCodeMemoryPlugin: Plugin = async (input, options) => {
  const runtime = createRuntime(input.client, input.directory)
  const services = await createServices(input, options, runtime).catch((error) => createDegradedServices(runtime, error))
  return createHooks(services)
}
```

Degraded services keep `health`, `status`, `doctor`-style diagnostics available and never throw during plugin construction.

- [ ] **Step 4: Verify GREEN and E2E**

Run: `bun test tests/unit/commands.test.ts tests/integration/plugin-hooks.test.ts tests/unit/plugin-contract.test.ts`

Expected: command registration, routing, manual CRUD, disable/enable, exact session injection and fail-open tests pass.

Run: `bun run check`

Expected: complete MVP unit/integration gates pass.

Run: `bun run test:e2e`

Expected: real OpenCode exposes `memory` plus all MVP commands; no provider call.

- [ ] **Step 5: Update docs, changeset and commit**

Update `README.md`, `docs/architecture.md`, `docs/compatibility.md` with MVP behavior and installation status.

```markdown
---
"@ttsimon/opencode-memory": minor
---

Add the manual persistent-memory MVP with local SQLite storage, project isolation, full-text recall, task continuity, security filtering, and management commands.
```

Save the file as `.changeset/calm-bears-remember.md`.

```bash
git add src tests README.md docs .changeset/calm-bears-remember.md
git commit -m "feat: deliver manual memory MVP"
```

## Phase 2: Automatic Memory

### Task 8: Deterministic Immediate Candidate Extraction

**Files:**
- Create: `src/lifecycle/extraction.ts`
- Create: `tests/unit/extraction.test.ts`
- Modify: `src/plugin/hooks.ts`

**Interfaces:**
- Produces `extractImmediateCandidates(turn): MemoryCandidate[]`; automatic threshold `0.85`.

- [ ] **Step 1: Write failing explicit-language tests**

```ts
test.each([
  ["Always answer me in Chinese", "global", "preference"],
  ["For this project, use bun for all scripts", "project", "rule"],
  ["We decided to keep SQLite as the source of truth", "project", "decision"],
])("extracts %s", (text, scope, kind) => {
  expect(extractImmediateCandidates(userTurn(text))).toMatchObject([{ scope, kind }])
})

test("does not auto-save speculation", () => {
  expect(extractImmediateCandidates(userTurn("Maybe we could use Redis someday"))).toEqual([])
})
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Run: `bun test tests/unit/extraction.test.ts tests/integration/plugin-hooks.test.ts`

Expected RED: extraction missing. GREEN: explicit preferences/rules/decisions save once, uncertain scope defaults project, low confidence and sensitive content do not persist, one concise toast summarizes writes.

- [ ] **Step 3: Commit**

```bash
git add src/lifecycle src/plugin/hooks.ts tests
git commit -m "feat: extract high-confidence memory candidates"
```

### Task 9: Idle Finalization, Task Continuity And Retry Queue

**Files:**
- Create: `src/lifecycle/finalization.ts`
- Modify: `src/plugin/hooks.ts`
- Create: `tests/integration/session-idle.test.ts`

**Interfaces:**
- Handles `todo.updated`, `file.edited`, `session.idle`; uses `client.session.messages`.

- [ ] **Step 1: Write failing event and retry tests**

```ts
test("session.idle fetches messages and updates the active task", async () => {
  await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
  expect(client.session.messages).toHaveBeenCalledWith({ path: { id: "s1" }, query: { directory } })
  expect(tasks.getActive(projectId)).toMatchObject({ goal: "Implement memory search" })
})

test("failed finalization stores only sanitized retry metadata", async () => {
  await finalizeFailure("password=hunter2")
  expect(database.dumpText()).not.toContain("hunter2")
  expect(pending.list()[0]?.attempts).toBe(1)
})
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Fetch last 100 messages, use text/todo/file metadata only, idempotency key `sessionID:idle:lastAssistantMessageID`, max 3 retry attempts. Completed tasks archive and are not injected.

Run: `bun test tests/integration/session-idle.test.ts tests/integration/task-service.test.ts`

Expected: task snapshots, idempotency, sanitized retry and retry limit tests pass.

- [ ] **Step 3: Commit**

```bash
git add src tests
git commit -m "feat: finalize memory on session idle"
```

### Task 10: Compaction Preservation

**Files:**
- Modify: `src/plugin/hooks.ts`
- Create: `tests/unit/compaction.test.ts`

- [ ] **Step 1: Write failing compaction test**

```ts
test("appends task and secret-safety requirements without replacing the prompt", async () => {
  const output = { context: [] as string[], prompt: undefined }
  await hooks["experimental.session.compacting"]?.({ sessionID: "s1" }, output)
  expect(output.prompt).toBeUndefined()
  expect(output.context.join("\n")).toContain("current task goal and status")
  expect(output.context.join("\n")).toContain("Do not copy sensitive information")
})
```

- [ ] **Step 2: Verify RED, implement, verify and commit**

Run: `bun test tests/unit/compaction.test.ts`

Expected: context appended once; active task fields are filtered; default prompt remains intact.

```bash
git add src/plugin/hooks.ts tests/unit/compaction.test.ts
git commit -m "feat: preserve task memory through compaction"
```

### Task 11: Conflict Replacement And Markdown Projection

**Files:**
- Modify: `src/memory-service.ts`
- Create: `src/projection/markdown.ts`
- Create: `tests/integration/conflicts.test.ts`
- Create: `tests/integration/markdown-projection.test.ts`

- [ ] **Step 1: Write failing conflict and rebuild tests**

```ts
test("new conflicting fact supersedes the old fact with audit history", () => {
  const old = remember("Tests use Jest", "test-runner")
  const current = remember("Tests use Bun", "test-runner")
  expect(memories.get(old.id)?.status).toBe("superseded")
  expect(current.supersedesId).toBe(old.id)
})

test("rebuilds damaged Markdown from SQLite", async () => {
  await writeFile(projectMemoryPath, "corrupt")
  await projection.rebuildProject(projectId)
  expect(await Bun.file(projectMemoryPath).text()).toContain("Generated from SQLite")
})
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Use atomic temporary-file rename, mode `0o600` where supported. `MEMORY.md` includes only stable high-importance active records and links to `topics/<kind>.md`. Projection failure never rolls back SQLite.

Run: `bun test tests/integration/conflicts.test.ts tests/integration/markdown-projection.test.ts tests/unit/security.test.ts`

Expected: supersession/audit/status filtering/deterministic projection/rebuild/no-secret tests pass.

- [ ] **Step 3: Commit**

```bash
git add src tests docs/decisions
git commit -m "feat: project auditable Markdown memory"
```

### Task 12: History And Non-Destructive Doctor

**Files:**
- Create: `src/diagnostics/doctor.ts`
- Modify: `src/plugin/commands.ts`
- Modify: `src/plugin/tool.ts`
- Modify: `src/plugin/hooks.ts`
- Create: `tests/unit/doctor.test.ts`
- Create: `tests/integration/history-command.test.ts`

**Interfaces:**
- Adds `/memory-history [id]`, `/memory-doctor`; tool actions `history`, `doctor`.

- [ ] **Step 1: Write failing history and doctor tests**

```ts
test("doctor checks storage without destructive repair", async () => {
  const report = await doctor.run(projectScope)
  expect(report.checks.map((check) => check.name)).toEqual([
    "database", "fts", "migration", "project", "permissions", "projection",
  ])
  expect(corruptDatabaseWasModified()).toBe(false)
})

test("history renders transitions without rejected source text", async () => {
  const output = await executeMemoryTool({ action: "history", id: memoryId }, context)
  expect(output).toContain("active -> superseded")
  expect(output).not.toContain("hunter2")
})
```

- [ ] **Step 2: Verify RED, implement and verify GREEN**

Doctor may check integrity, FTS, migration version, project resolution, permissions and projection drift. It only recommends backup restore/rebuild; it does not run `VACUUM`, delete, restore, change permissions or rewrite database by default.

Run: `bun test tests/unit/doctor.test.ts tests/integration/history-command.test.ts`

Expected: diagnostics/history/command registration/redaction/non-destructive tests pass.

- [ ] **Step 3: Commit**

```bash
git add src tests
git commit -m "feat: add memory history and diagnostics"
```

### Task 13: Full Acceptance And Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/compatibility.md`
- Create: `docs/usage.md`
- Modify: `tests/e2e/opencode-smoke.test.ts`

- [ ] **Step 1: Extend E2E acceptance without provider calls**

Test the real server's command list and tool IDs. Use isolated temporary data and direct tool/hook harnesses for CRUD and recall; never send a model prompt.

```ts
expect(commandNames).toEqual(expect.arrayContaining([
  "memory", "memory-status", "memory-search", "memory-show", "remember", "forget",
  "memory-enable", "memory-disable", "memory-history", "memory-doctor",
]))
expect(toolIds).toContain("memory")
```

- [ ] **Step 2: Document exact supported behavior**

`docs/usage.md` must document commands, local data paths, scope defaults, disable semantics, recall precedence/budgets, security guarantees, backups, doctor, restart requirement, and explicitly state Markdown import/edit/restore/export are not available.

- [ ] **Step 3: Run complete acceptance**

Run: `bun install --frozen-lockfile`

Expected: no lock changes.

Run: `bun run check`

Expected: format/lint/docs/type/coverage/build/package pass with zero warnings.

Run: `bun run test:e2e`

Expected: Windows/host local E2E passes without model/provider calls.

Run focused safety suite:

```bash
bun test tests/unit/security.test.ts tests/integration/memory-service.test.ts tests/integration/markdown-projection.test.ts tests/unit/doctor.test.ts
```

Expected: rejected secrets do not appear in database, projection, logs, backups or diagnostics fixtures.

- [ ] **Step 4: Add release changeset and commit**

```markdown
---
"@ttsimon/opencode-memory": minor
---

Add automatic memory extraction, idle-session finalization, compaction preservation, conflict replacement, Markdown projection, audit history, and diagnostics.
```

Save the file as `.changeset/bright-owls-recall.md`.

```bash
git add README.md docs tests .changeset/bright-owls-recall.md
git commit -m "docs: complete memory feature acceptance"
```

### Task 14: Pull Request, Required Checks And Merge

**Files:**
- No new source files expected.

- [ ] **Step 1: Inspect branch and push**

```bash
git status --short
git diff main...HEAD --stat
git log --oneline main..HEAD
git push -u origin feat/memory-mvp-auto
```

Expected: clean branch with only MVP/automatic-memory implementation and docs.

- [ ] **Step 2: Create PR**

```bash
gh pr create --base main --head feat/memory-mvp-auto --title "feat: add persistent OpenCode memory" --body "Implements the approved MVP and automatic-memory phases with local SQLite storage, recall, task continuity, security filtering, audit history, Markdown projection, and diagnostics."
```

- [ ] **Step 3: Wait for all required checks**

Run: `gh pr checks --watch`

Expected: quality, 3 platform tests, 2 E2E, pr-title, codeql, gitleaks and dependency-review pass. Fix failures in new commits; never bypass checks.

- [ ] **Step 4: Final review and squash merge**

Run a whole-branch review against `main`. Resolve all Critical/Important findings, rerun `bun run check` and `bun run test:e2e`, then:

```bash
gh pr merge --squash --delete-branch
```

Expected: protected `main` receives one feature commit; npm publishing remains disabled until Issue #2 is explicitly completed.

## Acceptance Matrix

| Requirement | Verification |
| --- | --- |
| Git root/child/worktree identity | `bun test tests/integration/project-resolver.test.ts` |
| Cross-project isolation and global recall | `bun test tests/integration/recall-engine.test.ts` |
| SQLite schema, FTS and migration backup | `bun test tests/integration/database.test.ts tests/integration/migrations.test.ts` |
| Manual CRUD and ambiguous delete | `bun test tests/integration/memory-service.test.ts` |
| Task continuity | `bun test tests/integration/task-service.test.ts tests/integration/session-idle.test.ts` |
| Fail-open Hooks | `bun test tests/unit/runtime.test.ts tests/integration/plugin-hooks.test.ts` |
| Automatic candidate extraction | `bun test tests/unit/extraction.test.ts` |
| Compaction preservation | `bun test tests/unit/compaction.test.ts` |
| Conflict/audit/Markdown rebuild | `bun test tests/integration/conflicts.test.ts tests/integration/markdown-projection.test.ts` |
| Secret zero-persistence | focused safety suite in Task 13 |
| History and doctor | `bun test tests/integration/history-command.test.ts tests/unit/doctor.test.ts` |
| OpenCode 1.18.18 compatibility | `bun run test:e2e` |
| Complete regression | `bun run check` |

## Explicitly Excluded

- `/memory-edit`, `/memory-restore`, `/memory-export`, `/memory-import`.
- Silent Markdown-to-SQLite synchronization.
- Vector, embedding or hybrid vector search.
- Git-tracked team memory, cloud sync or cross-device sync.
- Background repository or disk scanning.
- Destructive automatic doctor repairs.
- npm publication until external integrations in Issue #2 are completed and explicitly approved.
