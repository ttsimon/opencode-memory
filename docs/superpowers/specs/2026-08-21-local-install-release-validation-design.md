# Local Installation And Release Validation Design

日期：2026-08-21

状态：已确认，等待书面审阅

## 1. 目的

本文定义 OpenCode Memory 首次真实本地安装与发布验收流程。目标是在不提前发布 npm 包的前提下，用最终 tarball 在隔离环境和真实 OpenCode 全局环境中验证安装、升级、运行、回滚与完整合成数据 canary。

本文不新增产品功能，不启用 npm 发布，也不实现后续增强。

## 2. 当前事实与阻断条件

- 当前真实 OpenCode 版本为 `1.18.19`。
- 项目当前固定和验证的是 `1.18.18`，因此真实安装前必须先升级兼容基线。
- npm 包 `@ttsimon/opencode-memory` 尚不存在。
- 当前开发机未登录 npm。
- GitHub Release workflow 已配置 OIDC 权限，但由仓库变量 `NPM_PUBLISH_ENABLED` 默认禁用。
- npm Trusted Publishing 通常需要目标包存在后在 npm 包设置中配置。
- 真实 `~/.config/opencode/opencode.json` 当前包含明文 provider API Keys。这些密钥已经暴露到当前工具上下文，必须在继续真实安装前轮换。

## 3. 总体策略

采用同一 tarball 的分阶段 canary：

1. 升级并验证 OpenCode 1.18.19 兼容性。
2. 从干净 `main` 构建唯一 tarball，记录 commit、SHA-256 和内容清单。
3. 在完全隔离的 OpenCode 环境中从 tarball 安装并执行自动 canary。
4. 轮换真实密钥并迁移到环境变量引用。
5. 备份真实全局 OpenCode 配置与依赖。
6. 将同一 tarball 安装到真实全局配置。
7. 重启 OpenCode，在专用合成项目执行完整人工 canary。
8. 演练回滚并确认原环境可恢复。
9. 所有门禁通过后，再单独批准首次 npm bootstrap 发布。
10. npm 发布后从 registry 在全新隔离环境复验。

禁止使用源码路径替代 tarball 作为最终安装验收，因为源码加载无法验证发布包依赖、元数据和内容清单。

## 4. OpenCode 1.18.19 兼容升级

### 4.1 分支与版本

在独立分支 `chore/opencode-1.18.19-release-validation` 中同步升级：

- `@opencode-ai/plugin` 到 `1.18.19`
- `@opencode-ai/sdk` 到 `1.18.19`
- `opencode-ai` 到 `1.18.19`
- 真实 E2E helper 的期望版本到 `1.18.19`
- README、`docs/compatibility.md` 和相关工程文档

首版只保证 OpenCode `1.18.19`，不同时承诺 `1.18.18`。

### 4.2 API 核验

必须从 npm 发布包和 `anomalyco/opencode` 的 `v1.18.19` 标签源码重新核对：

- `PluginInput`
- `Hooks`
- `chat.message`
- `experimental.chat.system.transform`
- `experimental.session.compacting`
- `command.execute.before`
- `event` 中的 `session.idle`
- custom tool schema/context
- `client.session.messages`
- TUI toast 和 app log

不得仅依赖 TypeScript 编译通过判断兼容。

### 4.3 验证门禁

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run test:e2e`
- Windows、macOS、Ubuntu required checks
- CodeQL、Gitleaks、Dependency Review

兼容升级通过独立 PR 合并后才允许生成 canary tarball。

## 5. Canary Tarball

### 5.1 构建条件

- 工作分支已合并到 `main`。
- 本地 `main` 与 `origin/main` 一致。
- 工作树干净。
- 依赖使用 frozen lockfile。
- `NPM_PUBLISH_ENABLED` 保持未设置或非 `true`。

### 5.2 构建命令

```text
bun install --frozen-lockfile
bun run check
bun run test:e2e
bun pm pack --destination <canary-dir>
```

### 5.3 产物清单

生成 `canary-manifest.json`，记录：

- 包名：`@ttsimon/opencode-memory`
- 包版本
- tarball 文件名和绝对路径
- SHA-256
- Git commit SHA
- Bun 版本
- OpenCode 版本
- plugin/SDK 版本
- tarball 内 5 个文件的精确列表
- 构建时间

安装、真实 canary 和发布验收必须使用与 manifest SHA 匹配的同一 tarball。

## 6. 隔离 Tarball 安装

创建一次性根目录，隔离：

```text
config/
data/
cache/
state/
project/
artifacts/
```

在隔离 config 中：

1. 创建 `package.json`。
2. 通过 Bun 安装绝对 tarball 路径。
3. 创建带 `$schema` 的 `opencode.json`。
4. `plugin` 使用包名 `@ttsimon/opencode-memory`，不使用源码或 `dist/index.js`。
5. 设置隔离的 `OPENCODE_CONFIG_DIR`、XDG 和 Windows local-data 环境变量。

启动 `opencode serve` 并验证：

- OpenCode 为 1.18.19。
- 插件加载无错误。
- `memory` tool 存在。
- 10 个命令存在。
- 数据库和 Markdown 只出现在隔离数据目录。
- 停止后无遗留 OpenCode/Bun 进程。
- 临时目录可完整删除。

隔离验收失败时不得修改真实全局配置。

## 7. 真实配置安全迁移

### 7.1 密钥轮换

继续安装前，必须在各 provider 服务端轮换已经暴露的密钥。旧密钥应立即失效。

新密钥只保存在操作系统环境或安全凭据管理器中。OpenCode 配置使用：

```json
"apiKey": "{env:PROVIDER_API_KEY}"
```

安装日志、报告、备份摘要和 GitHub issue 不记录密钥值。

### 7.2 备份

创建同一时间戳的备份目录，保存：

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/package.json`
- `package-lock.json`
- `bun.lock`（如果存在）
- `plugins/`
- 安装前 resolved config 的脱敏摘要

备份目录只允许当前用户访问。

### 7.3 配置编辑

- 使用 JSONC parser 修改，不重写无关字段。
- 保留 `$schema`、MCP、provider 和已有插件。
- 将 `@ttsimon/opencode-memory` 添加到 plugin 数组末尾并去重。
- 不改变 superpowers 插件顺序。
- 先更新 `~/.config/opencode/package.json`，再安装 tarball。

## 8. 真实全局安装

全局 config 依赖使用 tarball 的绝对 `file:` 路径：

```json
"@ttsimon/opencode-memory": "file:C:/.../ttsimon-opencode-memory-<version>.tgz"
```

在 `~/.config/opencode` 中执行 Bun 安装。安装后验证：

- `node_modules/@ttsimon/opencode-memory` 存在。
- 包版本和 manifest 一致。
- 包文件 SHA 与 tarball 一致。
- OpenCode resolved config 包含原有插件及 memory 插件。

修改全局配置后必须退出并重新启动所有 OpenCode 实例。

## 9. 完整合成数据 Canary

### 9.1 数据隔离

使用专用临时 Git 项目。所有测试文本使用唯一前缀：

```text
OCM-CANARY-<timestamp>-
```

不得在真实工作项目中验收，也不得使用真实密钥作为安全测试数据。

### 9.2 基础加载

- OpenCode 1.18.19 正常启动。
- 现有 superpowers 插件正常。
- Figma MCP 配置仍可解析。
- provider 列表仍可解析。
- `memory` tool 与 10 个命令存在。

### 9.3 手动记忆

- 保存一个全局偏好。
- 保存一个项目规则。
- 搜索并 show 指定记录。
- 制造两条同关键词记录，确认歧义 forget 不删除。
- 按 ID 软删除。
- history 显示状态迁移。

### 9.4 安全

使用明确标记的假密钥，验证：

- `/remember` 拒绝。
- SQLite 不含原文。
- Markdown 不含原文。
- OpenCode 日志不含原文。
- `/memory-status`、history 和 doctor 不含原文。

### 9.5 跨会话与项目隔离

- 新会话召回全局偏好和当前项目规则。
- 第二个临时项目不能召回第一个项目的规则。
- 第二个项目仍可召回全局偏好。

### 9.6 自动记忆与任务续接

- 明确持续偏好自动沉淀。
- 确认决策自动沉淀。
- idle 后创建任务快照。
- 新会话能续接目标、相关文件和下一步。
- Todo 全部完成后任务归档。

### 9.7 Compaction 与投影

- Compaction 上下文保留目标、决策、阻塞、风险和下一步。
- 历史内容以不可执行 JSON 数据注入。
- 全局与项目 `MEMORY.md` 正确生成。
- 删除后旧 topic 内容不残留。
- doctor 全部通过，Windows ACL warning 可接受。

## 10. 回滚演练

以下任一情况立即回滚：

- OpenCode 无法启动。
- memory 插件加载失败。
- superpowers、MCP 或 provider 配置回归。
- 数据写入错误目录。
- canary 命令产生未捕获异常。
- 插件无法清理或禁用。

回滚步骤：

1. 停止所有 OpenCode 实例。
2. 恢复配置、package manifest、锁文件和 plugins 备份。
3. 删除本次安装的 memory 包依赖。
4. 删除 canary 前缀对应的合成记忆数据。
5. 重新安装原依赖。
6. 重启 OpenCode。
7. 验证原有插件、MCP 和 provider 恢复。

回滚演练必须实际执行一次：安装后回滚、验证恢复，再重新安装同一 tarball 并完成最终 canary。

## 11. npm 发布验收

真实本地 canary 全部通过后，才进入首次 npm 发布。

### 11.1 首次 bootstrap 发布

由于包尚不存在，首次发布采用受控本机 bootstrap：

- 用户执行 `npm login` 并完成 2FA。
- 验证 npm 用户拥有 `@ttsimon` scope 的发布权限。
- 运行 `npm publish --dry-run` 或等价 tarball检查。
- 显示将发布的包名、版本、tag、文件列表和 commit，要求再次确认。
- 执行一次公共发布。

本流程不创建或保存长期 npm token。

### 11.2 切换 Trusted Publishing

首包存在后，在 npm 包设置配置：

- GitHub user：`ttsimon`
- Repository：`opencode-memory`
- Workflow filename：`release.yml`
- Allowed action：`npm publish`

随后：

- 将发布权限设为要求 2FA 并禁止传统 token。
- 确认仓库没有 `NPM_TOKEN`。
- 设置 `NPM_PUBLISH_ENABLED=true` 前需单独批准。
- 验证 release workflow 能创建 Changesets release PR。

### 11.3 发布后复验

在全新隔离目录中从 npm registry 安装发布版本，验证：

- 包版本与 GitHub Release/tag 一致。
- npm provenance 存在。
- 工具和 10 个命令加载。
- remember/search/forget/history/doctor 基础链路通过。
- 未引用本地源码或 canary tarball。

## 12. 验收完成定义

只有全部满足才算完成：

- OpenCode 1.18.19 兼容 PR 合并。
- tarball manifest 与 SHA 固定。
- 隔离 tarball canary 通过。
- 已暴露密钥完成轮换并迁移环境变量。
- 真实配置备份完成。
- 真实全局安装通过。
- 完整合成 canary 通过。
- 回滚演练通过。
- 重装同一 tarball 后 canary 再次通过。
- 首次 npm 发布获得单独确认。
- Trusted Publishing 配置完成。
- npm registry 全新安装复验通过。

## 13. 非目标

- 不在验收过程中实现新功能。
- 不使用真实工作项目产生 canary 数据。
- 不自动发布 npm。
- 不保存长期 npm token。
- 不跳过密钥轮换。
- 不在未验证 1.18.19 前修改真实全局插件配置。
