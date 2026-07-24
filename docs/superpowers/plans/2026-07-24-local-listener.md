# 本地监听器实现计划

> **For agentic workers:** 本计划按内联执行，遵循 TDD；步骤使用 checkbox 跟踪。

**Goal:** 在创始人 Mac 上运行一个仅通过 HTTP API 访问云端收件箱、单并发执行本地任务并支持 launchd 常驻的监听器。

**Architecture:** `scripts/local-listener.mjs` 将配置、HTTP 请求、任务分流、CLI 子进程、租约续期和优雅下线集中在一个零依赖 ESM 脚本中，同时导出可注入的 `loadConfig` 与 `createListener` 供单测使用。任务仓库只由 `payload.projectId` 查本地 `LISTENER_REPO_MAP`，不读取服务端 `workspace/inbox/`；所有任务状态变化都调用 `/api/inbox/*`，Claude 进度调用 `/api/stream-events`。

**Tech Stack:** Node.js 20 ESM、`node:http` 之外的内置 `fetch`、`node:child_process`、`node:fs`、`node:test`；不新增依赖。

---

### Task 1: 监听器测试与可注入边界

**Files:**
- Create: `tests/unit/local-listener.test.mjs`
- Create: `scripts/local-listener.mjs`

- [ ] 写配置、任务分流、HTTP 序列、租约续期、单并发、优雅下线和通知测试。
- [ ] 使用注入 `fetchImpl` 与 `spawnImpl`，确认实现前测试失败。

### Task 2: 本地监听器实现

**Files:**
- Modify: `scripts/local-listener.mjs`

- [ ] 实现环境变量校验、唯一 claimedBy、HTTP API 调用与日志轮转。
- [ ] 实现 codex-task 的 tcd start/check、claude-task 的前后 progress、notify 的 osascript。
- [ ] 实现单并发轮询、10 分钟续租、失败 complete 和 SIGTERM 最多 60 秒收尾。
- [ ] 跑定向测试并逐项修正失败。

### Task 3: launchd 与运维文档

**Files:**
- Create: `scripts/local-listener.plist.template`
- Create: `docs/local-listener.md`

- [ ] 提供 RunAtLoad、KeepAlive、环境变量占位、日志重定向和安装命令。
- [ ] 说明 JSON 映射、任务 payload、权限、排查命令和 HTTP-only 架构边界。

### Task 4: 验证、报告与提交

**Files:**
- Create: `/private/tmp/claude-502/-Users-michael-projects-AI-----user-vibeloop/6eb20245-4a2b-4922-9975-bcc496412da8/scratchpad/impl-report-listener.md`

- [ ] 运行语法检查、定向测试和 `npm test`，记录实际统计。
- [ ] 检查 `git diff --check`、未修改 `workspace/`、无新依赖，并逐项核对需求。
- [ ] 写中文实现报告，执行 `git add` 和中文 commit，确认工作区干净。
