# Session Stream Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为工作台加入 append-only 会话流、消息/事件/附件 API、AI 自动回执、事件化 wait 和幂等历史迁移。

**Architecture:** `src/stream.mjs` 集中维护流文件契约；`src/server/server.mjs` 复用现有鉴权和精确 session 路径编排 API；`bin/workbench.mjs` 在 `events` 选项开启时同时轮询反馈和流。本地直读 workspace，远程走 JSON API。

**Tech Stack:** Node.js 20 ESM、`node:fs`、`node:path`、`node:crypto`、`node:test`，零新增依赖。

---

### Task 1: 流数据层与迁移

**Files:**
- Create: `src/stream.mjs`
- Create: `tests/unit/stream.test.mjs`

- [ ] **Step 1: 写失败测试**：验证 `appendStreamEntry(session, input)` 生成完整条目并追加 JSONL；`readStreamEntries(session,{since,limit})` 支持 ID/时间游标与最近 100；非法条目拒绝；`migrateSessionComments(session)` 保留作者/时间/轮次且重复执行新增数为 0。
- [ ] **Step 2: 运行红灯**：`node --test tests/unit/stream.test.mjs`，预期因 `src/stream.mjs` 不存在失败。
- [ ] **Step 3: 最小实现**：导出 `streamPath`、`appendStreamEntry`、`readStreamEntries`、`migrateSessionComments`；追加核心为：

```js
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
```

- [ ] **Step 4: 运行绿灯**：`node --test tests/unit/stream.test.mjs`，预期全部通过。

### Task 2: 消息、自动回执与主动事件 API

**Files:**
- Modify: `src/server/server.mjs`
- Create: `tests/e2e/session-stream.test.mjs`

- [ ] **Step 1: 写失败测试**：真实 server 覆盖消息实名、读取/增量、空白/4001 字、`message-posted`、round/feedback receipt、participant 调 stream-events 403、owner progress 成功。
- [ ] **Step 2: 运行红灯**：`node --test tests/e2e/session-stream.test.mjs`，预期新路由 404。
- [ ] **Step 3: 最小实现**：在身份解析之后增加三个路由；round 成功文本为 `已出第 N 轮：<title>`，feedback 成功文本为 `<name> 已提交第 N 轮反馈`；所有作者均由服务端构造。
- [ ] **Step 4: 运行绿灯**：`node --test tests/e2e/session-stream.test.mjs`，预期全部通过。

### Task 3: 附件上传

**Files:**
- Modify: `src/server/server.mjs`
- Test: `tests/e2e/session-stream.test.mjs`

- [ ] **Step 1: 写失败测试**：覆盖允许类型、5 MiB 边界、超限 413、类型 415、安全 slug、落盘内容、无 token 403、既有 assets URL 可读。
- [ ] **Step 2: 运行红灯**：目标测试预期新路由 404。
- [ ] **Step 3: 最小实现**：增加 5 MiB 有界 Buffer 读取、MIME→扩展映射、安全文件名函数和 `assets/uploads` 独占写入。
- [ ] **Step 4: 运行绿灯**：目标测试预期全部通过。

### Task 4: wait --events 与迁移 CLI

**Files:**
- Modify: `bin/workbench.mjs`
- Create: `tests/e2e/stream-cli.test.mjs`

- [ ] **Step 1: 写失败测试**：验证默认 wait 结构不变；本地和远程 `events:true` 被新消息唤醒；CLI 解析 `--events`；`stream-migrate <session>` 两次输出 `migrated:1/0`。
- [ ] **Step 2: 运行红灯**：`node --test tests/e2e/stream-cli.test.mjs`，预期缺选项/命令失败。
- [ ] **Step 3: 最小实现**：`cmdWait` 新增 `events=false`，启动时读取流尾，轮询反馈后读取增量；远程消息经 `GET /api/messages`；增加 `stream-migrate` 分支和帮助文本。
- [ ] **Step 4: 运行绿灯**：目标测试预期全部通过。

### Task 5: 文档、全量验证与审查

**Files:**
- Modify: `README.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/test-plan.md`

- [ ] **Step 1: 同步文档**：记录新文件契约、API、CLI、附件边界和 webhook 事件。
- [ ] **Step 2: 语法验证**：`node --check src/stream.mjs && node --check src/server/server.mjs && node --check bin/workbench.mjs`，预期退出 0。
- [ ] **Step 3: 全量验证**：`npm test`，预期 fail 0、skipped 0。
- [ ] **Step 4: 独立审查**：按规格逐项检查正确性、安全、复杂度和文档影响；修复后重跑全量。

## 自审

- 规格 1—6 分别映射 Task 1—4，测试与文档映射 Task 5，无缺口。
- 无新增依赖、无文件删除、无计划外前端或数据库功能。
- 名称统一：条目读取 `readStreamEntries`，新增 `appendStreamEntry`，迁移 `migrateSessionComments`，CLI 事件载荷字段为 `message`。
