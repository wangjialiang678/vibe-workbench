# 个人专属链接与逐人反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use TDD and verification-before-completion. 本任务由当前会话直接执行，不创建提交。

**Goal:** 落地 D5 个人 magic-link 身份、D6 逐人反馈与分歧标注，并补齐会话/设计资产导航。

**Architecture:** `src/participants.mjs` 独立管理仓库根名册；server 每次请求读取名册并解析 owner/participant 身份。参与者反馈写独立文件，首份反馈同步兼容桥以维持既有 listener/wait；GET 聚合兼容视图、逐人视图与冲突。前端只读追加逐人意见，不改变现有草稿和提交控件。

**Tech Stack:** Node.js 20+ ESM、`node:http`、`node:test`、原生 DOM/CSS，零外部依赖。

---

### Task 1: 名册契约与鉴权

**Files:**
- Create: `src/participants.mjs`
- Create: `tests/unit/participants.test.mjs`
- Modify: `.gitignore`
- Modify: `src/server/server.mjs`
- Modify: `tests/e2e/server.test.mjs`

- [x] 先写名册增删查、随机 token、重复/非法 id、吊销失效测试并确认失败。
- [x] 实现数组名册、同目录临时文件 + rename 原子写、逐 token 安全匹配。
- [x] 先写参与者 token 页面/API 放行、实际 token 透传、管理员 API 鉴权测试并确认失败。
- [x] 实现 `req.identity`、管理员三件套及完整 magic-link；管理员 token 只用于管理员身份，绝不泄漏给参与者页面。
- [x] 运行：`node --test tests/unit/participants.test.mjs tests/e2e/server.test.mjs`，预期全部通过。

### Task 2: 逐人反馈与兼容桥

**Files:**
- Modify: `src/workspace.mjs`
- Modify: `src/server/server.mjs`
- Modify: `tests/e2e/server.test.mjs`
- Modify: `tests/e2e/integration.test.mjs`

- [x] 先写 owner/participant 文件名、`submittedBy`、聚合响应、owner 优先、select 冲突和旧单人回归测试并确认失败。
- [x] 实现 `feedback-<id>.json`、首份兼容 `feedback.json`、确定性聚合与冲突检测。
- [x] 保留 owner 在 claimed 时的 409；允许 participant 后续补交且不倒退 claimed/responded/error 状态。
- [x] 运行：`node --test tests/e2e/server.test.mjs tests/e2e/integration.test.mjs`，预期全部通过。

### Task 3: CLI 与远程管理

**Files:**
- Modify: `bin/workbench.mjs`
- Modify: `tests/e2e/bin.test.mjs`
- Modify: `tests/e2e/present.test.mjs`

- [x] 先写本地及 `WORKBENCH_REMOTE_URL` 下 add/list/revoke 测试并确认失败。
- [x] 复用现有远程 JSON 请求封装，实现命令分发、中文输出与脱敏列表。
- [x] 运行：`node --test tests/e2e/bin.test.mjs tests/e2e/present.test.mjs`，预期全部通过。

### Task 4: 只读意见与头部导航

**Files:**
- Modify: `src/render/index.html`
- Modify: `src/render/app.mjs`
- Modify: `src/render/blocks.mjs`
- Modify: `src/render/app.css`
- Modify: `src/protocol/schema.mjs`
- Modify: `tests/unit/render.test.mjs`
- Modify: `tests/unit/protocol.test.mjs`
- Modify: `tests/e2e/present.test.mjs`

- [x] 先写只读意见 HTML/转义/分歧角标、`meta.docsUrl` 协议与页头数据流测试并确认失败。
- [x] 实现逐块只读意见、3 秒刷新、会话下拉、同源安全透传 token 的设计资产链接。
- [x] 运行：`node --test tests/unit/render.test.mjs tests/unit/protocol.test.mjs tests/e2e/present.test.mjs`，预期全部通过。

### Task 5: 文档、自审与全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/authoring-guide.md`
- Modify: `docs/test-plan.md`

- [x] 同步名册、API 响应、CLI、`meta.docsUrl` 与测试追踪说明。
- [x] 运行独立只读代码审查，修复高/中优先问题并重跑相关测试。
- [x] 运行：`npm test`，确认 0 fail、0 skipped、0 todo。
- [x] 检查：`git diff --check`、`git status --short`；不执行 git commit。
