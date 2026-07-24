# 常驻 worker 两项加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Codex 中断任务自动保存 Git 快照，并让未归属的新会话从首轮开始具备元数据和非阻断 warning。

**Architecture:** worker 在项目路由确定的仓库内执行隔离的中断善后函数；服务端在首轮写成功后调用既有项目元数据接口。CLI 只转发并显示服务端 warning，不复制服务端判定。

**Tech Stack:** Node.js 20 ESM、内置 `node:test`、系统 Git、零新增依赖。

---

### Task 1: 固定快照行为

**Files:**
- Modify: `tests/unit/resident-worker.test.mjs`
- Modify: `scripts/resident-worker.mjs`

- [ ] **Step 1: 写失败测试**

增加真实临时 Git 仓库 fixture，断言 `snapshotInterruptedWorktree(repo, { session, reason, now })` 创建 `codex-timeout-20260724T123456Z`、提交全部脏改动并切回干净原分支；再覆盖非 Git、受保护路径和注入 Git 失败。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/unit/resident-worker.test.mjs`  
Expected: FAIL，原因是快照 API/行为尚不存在。

- [ ] **Step 3: 写最小实现**

使用内置 `execFile` 调用 Git；严格校验仓库根目录与保护路径，按“status → 原分支 → switch -c → add -A → commit → switch 原分支 → status”顺序执行并返回结构化结果。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test tests/unit/resident-worker.test.mjs`  
Expected: PASS。

### Task 2: 接入中断回执

**Files:**
- Modify: `tests/unit/resident-worker.test.mjs`
- Modify: `scripts/resident-worker.mjs`

- [ ] **Step 1: 写失败测试并确认 RED**

用超时子进程和临时 Git 仓库执行 `runOnce`，断言 receipt 包含快照分支与 `git switch` 续跑指引。

Run: `node --test tests/unit/resident-worker.test.mjs`  
Expected: FAIL，固定旧回执不含快照信息。

- [ ] **Step 2: 写最小实现并确认 GREEN**

仅当 `timedOut || exitCode !== 0` 时调用快照函数，按结构化结果生成真实中文回执。

Run: `node --test tests/unit/resident-worker.test.mjs`  
Expected: PASS。

### Task 3: 新会话 warning 与元数据

**Files:**
- Modify: `tests/e2e/server.test.mjs`
- Modify: `tests/e2e/present.test.mjs`
- Modify: `src/projects.mjs`
- Modify: `src/server/server.mjs`
- Modify: `bin/workbench.mjs`

- [ ] **Step 1: 写失败测试并确认 RED**

断言未归属首轮响应含固定 warning，`session.json` 含标题、`kind:"work"`、`status:"active"`；注册项目会话不 warning；第二轮不重复；CLI stderr 打印 warning。

Run: `node --test tests/e2e/server.test.mjs tests/e2e/present.test.mjs`  
Expected: FAIL，当前响应无 warning 且首轮不写元数据。

- [ ] **Step 2: 写最小实现并确认 GREEN**

增加注册 session 名匹配函数；`/api/rounds` 首轮成功后合并写元数据并按归属附 warning；CLI 复制 warning 到结果并用 stderr 输出。

Run: `node --test tests/e2e/server.test.mjs tests/e2e/present.test.mjs`  
Expected: PASS。

### Task 4: 文档、自审与完整验证

**Files:**
- Modify: `docs/operations/resident-codex-runbook.md`
- Modify: `docs/test-plan.md`
- Create: 指定 `/private/tmp/.../scratchpad/impl-report-worker-hardening.md`

- [ ] **Step 1: 更新行为与运维说明**

记录快照分支、失败保留现场、warning 和待归类元数据规则。

- [ ] **Step 2: 主线程自审**

逐项检查假设、保护路径、失败分支、复杂度、文档影响和 `workspace/` diff。

- [ ] **Step 3: 完整验证并提交**

Run: `npm test`  
Expected: 494 个基线测试加新增测试全部通过，0 fail。

Run: `git diff --check && git status --short`  
Expected: 无格式错误且只有计划内文件。

最后用中文提交信息执行 `git add` 与 `git commit`，再确认工作区干净。

