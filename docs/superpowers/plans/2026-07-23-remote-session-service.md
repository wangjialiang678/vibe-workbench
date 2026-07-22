# 工作台远程会话服务化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI 以云端 workspace 为唯一事实源执行 present/wait，并在两类会话事件后发送可选 webhook。

**Architecture:** `src/workspace.mjs` 提供本地 CLI 与服务端共用的轮次落盘函数；`src/server/server.mjs` 新增受口令保护的写入/查询 API 和非阻塞 webhook；`bin/workbench.mjs` 根据 `WORKBENCH_REMOTE_URL` 选择本地文件或远程 HTTP 传输。

**Tech Stack:** Node.js ESM、内置 `http/fs/path/crypto`、全局 `fetch`、`node:test`，零新依赖。

---

### Task 1: 共享轮次写入契约

**Files:** `src/workspace.mjs`、`bin/workbench.mjs`、`tests/unit/workspace.test.mjs`、`tests/e2e/bin.test.mjs`

- [x] 测试自动 round、三文件落盘、独占写冲突，以及 `cmdRender` 继续复用共享函数。
- [x] 运行定向测试确认缺少共享函数而失败。
- [x] 把 blocks→Markdown 和 round 写入移动到 workspace；独占模式用原子 round 目录占位，抛带稳定 code 的冲突错误，失败时只回收本次占位。
- [x] 运行 workspace/bin 定向测试至通过。

### Task 2: 服务端轮次与反馈查询 API

**Files:** `src/server/server.mjs`、`tests/e2e/server.test.mjs`

- [x] 覆盖 POST 正常、409、403、413、schema/lint 拒绝和 `allowIncomplete=1` 放行。
- [x] 覆盖 GET feedback pending、命中和参数错误。
- [x] 运行 server 测试确认新路由均失败。
- [x] 实现 2 MiB 限流 JSON reader、参数校验、共享写入调用及远程 render URL。
- [x] 运行 server 定向测试至通过。

### Task 3: CLI 远程 present/wait

**Files:** `bin/workbench.mjs`、`tests/e2e/present.test.mjs`

- [x] 用本地鉴权 server 作为远程端，覆盖 present、allowIncomplete、wait、timeout 和网络错误中文化。
- [x] 运行 present 测试确认远程请求未发生而失败。
- [x] 实现远程 URL 归一、token header、错误解析、页面 token query 和 3 秒轮询；本地分支保持原函数路径。
- [x] 运行 present/bin 定向测试至通过。

### Task 4: 事件 webhook

**Files:** `src/server/server.mjs`、`tests/e2e/server.test.mjs`

- [x] 用本地 stub 断言 `round-presented` 与 `feedback-submitted` 的精确最小 payload。
- [x] 断言 webhook 不响应/失败时业务响应仍成功。
- [x] 实现启动时固定配置、5 秒 abort、timer 清理、`void` 异步投递和失败日志。
- [x] 运行 server 定向测试至通过。

### Task 5: 文档与全量验证

**Files:** `docs/DESIGN.md`、`docs/test-plan.md`、`docs/项目与技能说明.md`

- [x] 记录新增 API、三个环境变量、远程命令行为和 webhook best-effort 语义。
- [x] 运行 `node --check` 检查所有修改的 ESM 文件。
- [x] 运行 `npm test`，确认无失败、无 skip。
- [x] 独立只读审查需求覆盖、安全性、兼容性；修复阻塞问题后重跑全量。

> 用户明确要求不创建 git commit，因此本计划不包含提交步骤。
