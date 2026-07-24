# Executor Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为云端 server 增加按执行面分格的持久化任务收件箱，并按项目 executor 在 resident webhook 与 pull inbox 之间分流。

**Architecture:** `src/projects.mjs` 提供静态执行面目录和项目 executor 归一化；新模块 `src/executor-inbox.mjs` 独占任务校验、原子 JSON、状态迁移与超时扫描；`src/server/server.mjs` 映射管理员 API、写完成回执，并替换三个既有 webhook 派发点。拉取型任务保存原 webhook 事件体，因此未来本地监听器无需理解 server 内部对象。

**Tech Stack:** Node.js 20 ESM、`node:http`、同步 `node:fs` 原子 rename、`node:test`；不新增依赖。

---

### Task 1: 注册表 executor 契约

**Files:**
- Modify: `src/projects.mjs`
- Modify: `tests/unit/projects.test.mjs`

- [ ] **Step 1: 写失败测试**

断言 `EXECUTORS` 含 `cloud-codex/resident` 与 `local-mac/pull`；缺省项目归一成 `cloud-codex`；显式 `local-mac` 被保留；未知 executor 报错。

- [ ] **Step 2: 确认 RED**

Run: `node --test tests/unit/projects.test.mjs`
Expected: FAIL，原因是 executor 目录或默认字段尚不存在。

- [ ] **Step 3: 最小实现**

导出 `DEFAULT_EXECUTOR_ID`、冻结的 `EXECUTORS` 和 `executorById(id)`；`cleanProject` 校验并保存 executor；`publicProject` 返回 executor。

- [ ] **Step 4: 确认 GREEN**

Run: `node --test tests/unit/projects.test.mjs`
Expected: PASS。

### Task 2: Inbox HTTP 契约测试

**Files:**
- Create: `tests/e2e/executor-inbox.test.mjs`

- [ ] **Step 1: 写失败测试**

用临时 `WB_WORKSPACE` 和管理员/参与者 token 启动 server，覆盖：

```js
await post('/api/inbox/tasks', {
  executor: 'local-mac',
  session: 'inbox-basic',
  type: 'manual',
  title: '本地任务',
  payload: { instruction: '执行' },
});
await post(`/api/inbox/tasks/${id}/claim`, { claimedBy: 'founder-mac' });
await post(`/api/inbox/tasks/${id}/complete`, { ok: true, summary: '完成' });
```

并断言列表、原子 claim 竞争只有一个赢家、失败 `message`、幂等 complete 不重复回执、renew 续租、64 KiB 边界、畸形 executor、参与者 `403`、短超时自动回退历史，以及 resident webhook/pull inbox 分流。

- [ ] **Step 2: 确认 RED**

Run: `node --test tests/e2e/executor-inbox.test.mjs`
Expected: FAIL，现有 server 对 inbox API 返回 `404`，pull 事件仍进入 webhook。

### Task 3: 原子 Inbox 数据层

**Files:**
- Create: `src/executor-inbox.mjs`
- Modify: `src/workspace.mjs`
- Modify: `tests/unit/workspace.test.mjs`

- [ ] **Step 1: 实现公开契约**

模块导出：

```js
export const INBOX_PAYLOAD_LIMIT = 64 * 1024;
export const DEFAULT_CLAIM_TIMEOUT_MS = 30 * 60 * 1000;
export function enqueueInboxTask(input, { now } = {});
export function listInboxTasks({ executor, status, now, claimTimeoutMs } = {});
export function claimInboxTask(id, claimedBy, { now, claimTimeoutMs } = {});
export function renewInboxTask(id, claimedBy, { now, claimTimeoutMs } = {});
export function completeInboxTask(id, result, { now, claimTimeoutMs } = {});
export function resetExpiredInboxClaims({ now, claimTimeoutMs } = {});
```

每次写入使用同目录 `.<name>.<pid>.<random>.tmp`、`0600` 和 `fs.renameSync`。claim 先把 canonical 文件 rename 为唯一 claim 文件，成功后才读取解析，再写入 `claimedBy/claimedAt/leaseExpiresAt` 并 rename 回 canonical；竞争败者不读内容。所有路径只由注册 executor 和 UUID 组成。

- [ ] **Step 2: 状态机最小实现**

`pending` 才能 claim，`claimed` 才能 renew/首次 complete；renew 要求 `claimedBy` 匹配。`done/failed` 的 complete 直接幂等返回现状。冲突抛 `INBOX_CONFLICT`，不存在抛 `INBOX_NOT_FOUND`，输入错误抛 `INVALID_INBOX_TASK`。超时把任务恢复为 pending 并追加 `claim-expired` 历史。

- [ ] **Step 3: 保留 workspace/inbox**

`workspace.mjs` 把 `inbox` 设为保留目录：`isValidSessionName('inbox') === false`，且 `listSessions()` 永不把队列根目录当会话返回。

### Task 4: 管理员 API 与完成回执

**Files:**
- Modify: `src/server/server.mjs`

- [ ] **Step 1: 增加 API 路由**

所有 `/api/inbox/*` 先检查：

```js
if (!expectedToken || identity.role !== 'owner') {
  json(res, 403, { ok: false, error: '仅管理员执行器可访问收件箱' });
  return;
}
```

POST 入队返回 `201`，GET 列表返回 `200`，claim/renew/complete 返回 `200`；按错误 code 映射 `400/404/409`，payload 超限映射 `413`。

- [ ] **Step 2: 完成时写 session 流**

`ok: true` 追加 `receipt` 文案 `任务执行完成：<summary>`；`ok: false` 追加 `message` 文案 `任务执行失败：<summary>`，作者固定为 AI。只有首次状态转换写回执；幂等重试只返回当前任务。

- [ ] **Step 3: 确认核心 API GREEN**

Run: `node --test tests/e2e/executor-inbox.test.mjs --test-name-pattern='入队|领取|完成|超时|executor|管理员'`
Expected: PASS。

### Task 5: 事件分流与自动扫描

**Files:**
- Modify: `src/server/server.mjs`

- [ ] **Step 1: 替换派发函数**

新增按 `registeredProjectForSession(payload.session)` 解析 executor 的派发函数。resident 调用既有异步 webhook；pull 同步入队原事件 payload，并追加：

```js
appendStreamEntry(payload.session, {
  author: AI_IDENTITY,
  kind: 'progress',
  text: `已入队待本地执行：${task.title}`,
}, { exactSession: true });
```

解析或入队异常只记录日志；无项目归属回退 webhook。

- [ ] **Step 2: 启动超时扫描**

`startServer` 读取 `WORKBENCH_INBOX_CLAIM_TIMEOUT_MS`，启动 `unref()` 定时器，server close 时清除；扫描间隔不超过 60 秒。

- [ ] **Step 3: 确认完整定向测试 GREEN**

Run: `node --test tests/unit/projects.test.mjs tests/e2e/executor-inbox.test.mjs`
Expected: PASS。

### Task 6: 文档、全量验证与提交

**Files:**
- Create: `docs/executor-inbox-protocol.md`
- Modify: `docs/test-plan.md`
- Create: `/private/tmp/claude-502/-Users-michael-projects-AI-----user-vibeloop/6eb20245-4a2b-4922-9975-bcc496412da8/scratchpad/impl-report-inbox.md`

- [ ] **Step 1: 同步协议与测试矩阵**

协议明确目录、JSON 字段、管理员鉴权、64 KiB 算法、租约/续租/at-least-once、幂等 complete、HTTP-only 文件边界、`WORKBENCH_INBOX_CLAIM_TIMEOUT_MS`、回执文案和兼容回退；测试计划登记新增测试文件。

- [ ] **Step 2: 语法与全量测试**

Run:

```bash
node --check src/projects.mjs
node --check src/executor-inbox.mjs
node --check src/server/server.mjs
npm test
```

Expected: 全部退出码为 0、无 skip/fail。

- [ ] **Step 3: 主线程自审**

检查 `git diff --check`、`git diff --stat` 和完整 diff，逐项核对协议六项、未修改 `resident-worker.mjs`、未新增依赖、未触碰 `workspace/` 现有数据。

- [ ] **Step 4: 写报告并提交**

报告记录文件清单、API/状态机/分流设计、测试统计和 commit。执行：

```bash
git add src/projects.mjs src/executor-inbox.mjs src/server/server.mjs src/workspace.mjs \
  tests/unit/projects.test.mjs tests/unit/workspace.test.mjs tests/e2e/executor-inbox.test.mjs \
  docs/executor-inbox-protocol.md docs/test-plan.md \
  docs/superpowers/plans/2026-07-24-executor-inbox.md
git commit -m "实现：新增执行面收件箱与派发分流"
git status --short
```

Expected: commit 成功，仓库内改动全部已提交；外部 scratchpad 报告存在但不进入仓库 commit。
