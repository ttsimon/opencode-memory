# OpenCode Memory Repository Engineering Standards

日期：2026-08-20

状态：已确认，等待书面审阅

## 1. 目的

本文定义 OpenCode Memory 在功能开发前必须建立的工程基线。它约束工具链、代码质量、测试、Git 协作、CI、安全、依赖、版本、发布和文档，确保后续 MVP 与自动记忆实现可复现、可审查、可发布。

产品行为仍以 `docs/2026-08-20-opencode-memory-design.md` 为准。本文不修改产品范围，不实现任何记忆功能。

## 2. 仓库与发布身份

- GitHub 仓库：`https://github.com/ttsimon/opencode-memory.git`
- 默认分支：`main`
- npm 包：`@ttsimon/opencode-memory`
- 初始开发版本：`0.1.0`
- 许可证：MIT
- npm 包为公共 ESM 包。
- npm 包只公开插件入口 `.`，内部模块不是稳定公共 API。
- README、贡献指南、API 文档、代码注释和发布说明使用英文。
- 产品设计与内部实施计划可以使用中文。

无作用域 npm 包 `opencode-memory` 已被其他发布者占用，因此不得用于本项目发布。

## 3. 工具链与版本基线

### 3.1 版本

仓库使用精确版本，不使用浮动范围管理关键工具：

| 组件 | 版本 | 约束位置 |
| --- | --- | --- |
| Bun | `1.3.14` | `.mise.toml`、`package.json#packageManager` |
| OpenCode | `1.18.18` | 兼容矩阵、E2E |
| `@opencode-ai/plugin` | `1.18.18` | `package.json` |
| `@opencode-ai/sdk` | `1.18.18` | `package.json` |
| TypeScript | `5.8.2` | `package.json` |
| Zod | `4.1.8` | `package.json` |
| Biome | `2.5.9` | `package.json` |
| Changesets | `3.0.1` | `package.json` |

Bun `1.3.14` 与 OpenCode `v1.18.18` 源码中的 `packageManager` 保持一致。OpenCode plugin 与 SDK 版本必须始终一致。

### 3.2 环境管理

`.mise.toml` 是本地工具版本入口：

```toml
[tools]
bun = "1.3.14"
```

标准开发流程：

```bash
mise install
bun install --frozen-lockfile
bun run check
```

开发者需要安装 Git 和 mise。Bun 由 mise 管理。生产插件不得要求用户另外安装 Node.js。

### 3.3 包管理

- 唯一包管理器为 Bun。
- 唯一依赖锁文件为 `bun.lock`。
- `package.json` 声明 `"packageManager": "bun@1.3.14"`。
- 禁止提交 `package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`。
- CI 必须使用 `bun install --frozen-lockfile`，不得隐式修改锁文件。

### 3.4 平台支持

- 开发和核心测试支持 Windows、Linux、macOS。
- CI 在三平台运行单元与集成测试。
- 真实 OpenCode 宿主 E2E 至少运行 Windows 和 Ubuntu。
- 路径、权限、Git worktree 和 SQLite 行为必须有跨平台测试。

## 4. 源码与模块结构

目标结构：

```text
src/
├── index.ts
├── plugin/
│   ├── hooks.ts
│   ├── commands.ts
│   ├── tool.ts
│   └── runtime.ts
├── domain/
│   ├── types.ts
│   └── classification.ts
├── project/
│   └── resolver.ts
├── security/
│   ├── filter.ts
│   └── redaction.ts
├── storage/
│   ├── database.ts
│   ├── migrations.ts
│   ├── memory-repository.ts
│   ├── task-repository.ts
│   └── audit-repository.ts
├── recall/
│   ├── engine.ts
│   └── render.ts
├── lifecycle/
│   ├── extraction.ts
│   └── finalization.ts
├── projection/
│   └── markdown.ts
└── diagnostics/
    └── doctor.ts
```

模块边界：

- `domain` 不依赖 OpenCode、SQLite 或文件系统。
- `storage` 只处理持久化、SQL、迁移和事务。
- `security` 是数据库、日志、Markdown、备份和诊断输出前的强制边界。
- `plugin` 是唯一直接依赖 OpenCode Hook 类型的目录。
- `index.ts` 只创建服务和组合 Hooks。
- `recall` 通过 repository 接口读取数据，不散落执行 SQL。
- `projection` 单向读取 SQLite；Markdown 不是并列事实源。
- 每个文件承担一个清晰职责；不为未来增强提前创建抽象。
- `tests/` 镜像源码职责结构，公共 fixture 和 fake 放在 `tests/helpers/`。

## 5. SQLite 技术选型

使用 Bun 内置 `bun:sqlite`，不使用 `better-sqlite3`。

原因：

- 插件由 OpenCode 的 Bun 运行时加载。
- 无额外原生依赖安装和 Node-API ABI 风险。
- 降低 Windows、Linux、macOS 预编译产物差异。
- 测试与生产使用同一 SQLite 驱动。
- 符合 Bun-only 工具链。

数据库访问必须集中在 `src/storage/`。业务层不得直接导入 `bun:sqlite`。

## 6. TypeScript 规范

### 6.1 编译配置

采用 ESM 和严格模式，至少开启：

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "types": ["bun"]
  }
}
```

### 6.2 类型规则

- 禁止隐式 `any`。
- 外部输入以 `unknown` 进入，经 Zod 或类型守卫验证后进入领域层。
- 非测试代码原则上禁止 `as any`、`@ts-ignore` 和非空断言。
- 宿主 API 类型缺口确实要求绕过时，必须有紧邻英文注释和行为测试。
- 导出的领域接口和公共函数写显式返回类型。
- 内部短小函数允许类型推断。
- 优先使用判别联合、`satisfies`、readonly 数据和穷尽检查。
- 不暴露内部存储行类型作为领域 API。

## 7. 格式化、Lint 与命名

使用 `@biomejs/biome@2.5.9`，不叠加 Prettier 或 ESLint。

格式：

- 2 空格缩进。
- 双引号。
- 不使用分号。
- 使用尾逗号。
- 行宽 120。
- LF 换行。
- 文件末尾必须有换行。
- 自动排序 import。

命名：

- 文件：`kebab-case.ts`
- 类型和类：`PascalCase`
- 函数和变量：`camelCase`
- 真正常量配置：`UPPER_SNAKE_CASE`
- 测试名称描述可观察行为，不描述内部实现。

脚本：

```text
bun run format          写入格式修复
bun run format:check    只校验格式
bun run lint            只报告 Lint 问题
bun run typecheck       TypeScript 类型检查
bun run check           格式、Lint、类型、测试、构建总门禁
```

任何格式、Lint 或类型错误都阻止合并。禁止在 CI 中通过全局 ignore 掩盖问题。

## 8. 注释与文档语言

- 代码注释使用英文。
- 注释解释原因、约束或非显然行为，不复述代码。
- 公共 README、CONTRIBUTING、SECURITY、ADR 和发布说明使用英文。
- 中文产品设计和实施计划保留在 `docs/` 与 `docs/superpowers/`。
- 用户可见命令文案按产品设计实现；工程文档语言不限制插件未来本地化。

## 9. 测试规范

### 9.1 框架与目录

使用 Bun 原生 `bun:test`，不引入 Vitest。

```text
tests/
├── unit/
├── integration/
├── e2e/
└── helpers/
```

- `unit`：纯函数、分类、敏感过滤、排序、预算和状态迁移。
- `integration`：真实临时 SQLite、Git 仓库/worktree、Markdown、迁移和备份。
- `e2e`：真实 OpenCode 1.18.18 插件加载、命令注册、Hooks 和故障降级。

### 9.2 隔离要求

- 单元测试不得访问网络、真实用户目录或真实 OpenCode 全局配置。
- 文件和数据库测试使用临时目录，并在测试结束时清理。
- E2E 使用隔离的 OpenCode 配置和数据目录。
- 测试不得依赖调用云端模型。
- 确定性宿主测试使用 `/command`、SDK、fake client 或 `noReply` 路径。

### 9.3 TDD 与回归

- 新功能先写失败测试，再写最小实现。
- Bug 修复先写可复现失败的回归测试。
- 每个新行为至少覆盖正常、边界和失败路径。
- 安全、迁移、软删除、项目隔离和 fail-open 必须有显式正反例。
- 总覆盖率不能替代关键行为断言。

### 9.4 覆盖率

最低门槛：

| 指标 | 门槛 |
| --- | --- |
| Lines | 90% |
| Functions | 90% |

Bun `1.3.14` 原生覆盖率阈值只可靠强制 `lines` 和 `functions`。它接受 `statements` 配置但不执行阈值，也不提供可强制的 branch threshold，因此本文不声明无法自动执行的 statements/branches 门禁。安全、迁移、软删除、项目隔离和 fail-open 分支通过必需的显式正反例测试保证。

`bunfig.toml` 至少包含：

```toml
[test]
coverageThreshold = { lines = 0.9, functions = 0.9 }
coverageReporter = ["text", "lcov"]
coverageSkipTestFiles = true
```

脚本：

```text
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test
bun run test:coverage
```

## 10. Git 与协作流程

### 10.1 分支

- 默认分支为 `main`。
- `main` 禁止直接 push，所有变更通过 PR。
- 功能分支保持短生命周期。

分支命名：

```text
feat/<topic>
fix/<topic>
docs/<topic>
chore/<topic>
release/<version>
```

### 10.2 提交

使用 Conventional Commits：

```text
feat:
fix:
docs:
test:
refactor:
chore:
ci:
build:
```

- PR 标题必须符合 Conventional Commits。
- 合并方式为 squash merge。
- 最终 `main` 历史保持一个逻辑变更一个提交。
- 禁止提交生成目录、覆盖率、本地数据库、日志、真实记忆数据或 OpenCode 全局配置。

### 10.3 本地 Hooks

使用 Husky、lint-staged 和 commitlint：

- `pre-commit` 只检查暂存的 TypeScript、JSON 和 Markdown。
- `commit-msg` 校验 Conventional Commits。
- 本地 Hook 不运行完整测试；完整门禁由 CI 执行。

### 10.4 PR 内容

PR 模板要求：

- 变更摘要。
- 测试证据。
- 安全影响。
- OpenCode API 兼容影响。
- 数据库迁移影响。
- 用户文档和 changeset 状态。

## 11. GitHub 仓库治理

仓库提供：

```text
.github/CODEOWNERS
.github/pull_request_template.md
.github/ISSUE_TEMPLATE/bug-report.yml
.github/ISSUE_TEMPLATE/feature-request.yml
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
LICENSE
```

初始 CODEOWNERS：

```text
* @ttsimon
```

`main` 分支保护：

- 要求 PR。
- 要求全部必需 CI checks。
- 要求分支与 `main` 同步。
- 要求解决全部 review conversations。
- 禁止 force push 和删除分支。

GitHub 仓库设置启用：

- Secret Scanning。
- Push Protection。
- Dependabot Alerts。
- Dependency Graph。
- Private Vulnerability Reporting。

## 12. CI 设计

### 12.1 `ci.yml`

Ubuntu 快速门禁：

- Biome format check。
- Biome lint。
- TypeScript typecheck。
- 覆盖率。
- 构建。
- 发布 tarball 内容检查。

平台矩阵：

- Windows、Ubuntu、macOS：单元和集成测试。
- Windows、Ubuntu：OpenCode 1.18.18 E2E。

所有 Job 使用 `jdx/mise-action` 读取 `.mise.toml`，然后执行 frozen install。

### 12.2 `security.yml`

- CodeQL 扫描 TypeScript/JavaScript。
- Gitleaks 扫描提交历史。
- PR 使用 GitHub Dependency Review 阻止新增高危依赖。
- 每周定时运行完整安全扫描。

### 12.3 Actions 权限

- 默认 `contents: read`。
- 非发布 Job 不得获取写权限。
- 发布 Job 仅授予 `contents: write` 和 `id-token: write`。
- GitHub Actions 第三方 action 固定完整 commit SHA，不使用浮动 tag。

## 13. 依赖升级

使用 Renovate：

- 每周创建一次依赖升级 PR。
- 普通 patch/minor 可分组。
- major 单独 PR，禁止自动合并。
- Bun、TypeScript、OpenCode plugin 和 SDK 必须单独 PR。
- OpenCode plugin 与 SDK 同步升级。
- 关键升级 PR 必须附 API 合约和真实宿主 E2E 证据。
- Renovate 更新固定 SHA 的 GitHub Actions。
- 所有依赖 PR 必须提交更新后的 `bun.lock`。

高危漏洞阻止发布。无法立即修复时，必须记录影响范围、缓解措施、负责人和修复截止日期。

## 14. 版本与发布

### 14.1 SemVer

- 初始版本为 `0.1.0`。
- MVP 与自动记忆验收前保持 `0.x`。
- 用户可见破坏性变化按 SemVer 和 Changesets 明确记录。
- 数据库 schema 版本独立于 npm 包版本。
- 数据库迁移只向前执行，迁移前备份，不静默降级。

### 14.2 Changesets

使用 `@changesets/cli@3.0.1`：

- 用户可见功能和修复必须包含 changeset。
- 纯测试、内部重构、CI 和仅工程文档可以不含 changeset。
- Changesets 维护 `CHANGELOG.md` 和发布 PR。

### 14.3 发布门禁

发布前执行：

```bash
bun run check
bun run test:e2e
bun run build
bun pm pack
```

必须人工或自动检查 tarball 内容，只允许发布运行时产物、类型声明、README、LICENSE 和必要元数据。

### 14.4 发布渠道

- Changesets 发布 PR 合并后触发 `release.yml`。
- 发布 npm 公共包 `@ttsimon/opencode-memory`。
- 同步创建 GitHub Release。
- 使用 npm trusted publishing / GitHub OIDC 和 provenance。
- 仓库不保存长期 `NPM_TOKEN`。
- 禁止从开发机直接执行 `npm publish` 或 `bun publish`。

## 15. OpenCode 兼容策略

- 首版只保证 OpenCode `1.18.18`。
- plugin 与 SDK 使用精确 `1.18.18`，不用 `^` 或 `~`。
- README 和 `docs/compatibility.md` 维护兼容矩阵。
- OpenCode 升级通过独立 PR 和独立兼容版本发布。
- 升级必须重新核对插件 API、事件载荷、自定义命令和 SDK。
- 实验性 Hook 变化可以让记忆能力降级，但不得阻断 OpenCode 宿主。
- 兼容性烟雾测试必须覆盖插件初始化和命令注册，不能只做类型检查。

## 16. 文档与 ADR

工程治理阶段创建：

```text
README.md
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
LICENSE
docs/architecture.md
docs/compatibility.md
docs/decisions/0001-bun-toolchain.md
docs/decisions/0002-bun-sqlite.md
docs/decisions/0003-command-routing.md
```

ADR 规则：

- 使用连续四位编号。
- 记录背景、决定、理由、替代方案和后果。
- 安全边界、数据库迁移策略、OpenCode Hook 适配或发布模型变化必须更新或新增 ADR。
- ADR 一经接受不重写历史；新决定通过新 ADR 替代旧决定。

## 17. 完成定义

任何功能只有同时满足以下条件才算完成：

- 行为有测试，关键失败路径有回归测试。
- `bun run check` 通过。
- `bun run test:e2e` 通过。
- 用户可见变更有 changeset。
- 用户可见变更有英文文档更新。
- 安全、迁移和兼容影响已在 PR 中说明。
- 需要 ADR 的架构变化已记录。
- 发布包内容检查通过。
- 不包含密钥、真实记忆、本地配置或临时数据库。

功能代码开始前，工程治理提交必须先进入 `main` 并由 CI 验证。

## 18. 工程治理阶段交付物

第一阶段只建立规范和自动门禁，不实现记忆功能。交付物包括：

- Git 仓库初始化和远端绑定。
- mise/Bun/TypeScript/Biome 配置。
- Bun 测试、覆盖率和构建脚本。
- Husky、lint-staged、commitlint。
- GitHub CI、安全和发布工作流。
- Renovate 和 Changesets。
- README、贡献、安全、行为准则、许可证和 ADR。
- 分支保护及 GitHub 安全设置核对清单。
- 一个最小、无业务逻辑的 OpenCode 插件入口，用于 API 类型和宿主加载烟雾测试。

完成该阶段并获批后，重新生成 MVP 与自动记忆实施计划，使所有任务使用 Bun、`bun:test`、`bun:sqlite` 和本文定义的门禁。

## 19. 非目标

工程治理阶段不包含：

- SQLite 记忆数据模型。
- 项目识别。
- 敏感信息过滤实现。
- 召回、任务快照或自动提取。
- 记忆管理命令业务逻辑。
- 修改用户真实 OpenCode 全局配置。
- npm 正式发布。
