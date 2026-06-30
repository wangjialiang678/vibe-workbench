# 交付报告 — 通用人机交互层 MVP（全量）

日期：2026-06-30 · 流程：auto-dev 闭环（设计 → UX 自审 → 并行 TDD → 集成验证）

## 1. 概述
按用户绿灯"全量实现 + 完整自动化测试、全自动闭环"，完成通用人机交互层：通用 block 协议 + 注意力路由 + 轮次 diff + 容错恢复 + 异步唤醒回路 + 两模板 + CLI。零运行时依赖、纯 ESM。

## 2. 需求落地
- D1-D8 全部实现；FR-1~FR-6 实现并测试；FR-7（注意力分区）、FR-8（diff + removed + 字段级对照）实现。
- UX 自审 3×P0 全部落地：盲签防护（submitSummary/unanswered + 409 保护）、心跳联合判定（displayState：claimed+鲜=processing 不误判）、区 C 分级（zoneCReview/zoneCFyi）。多条 P1（错误 kind/可重试性、自愈终态 dead、异步计时、diff removed、可访问性形状图标）已落地。

## 3. 测试结果（独立重跑核对，非子代理自述）
- 全量 `node --test`：**118 通过 / 0 失败**，退出码 0。
  - protocol 14 · workspace 2 · server(e2e) 12 · loop(e2e) 27 · render 33 · templates 20 · bin(e2e) 7 · 集成(e2e) 3。
- 端到端集成（真实模块 + mock 驱动）：S1 think-discuss 往返、S5 崩溃→error→retry→恢复、幂等不重复处理 —— 全绿。
- 真实启动冒烟：`bin serve` 起服务，/api/health、root→render 302、render 页/app.mjs/css/protocol 模块全 200，content API 注入 `_change`。
- 解析校验：19 个 .mjs 全部 `node --check` 通过；app.mjs 导入全部解析到位。

## 4. 集成发现与修复（Phase 3）
- **bin↔server 契约不一致**：`bin serve/up` 误以对象 `startServer({port})` 调用，而 server 为 `startServer(portNumber)` → 服务起不来。已修为传数字 + 默认端口 8099 + 启动日志。属预算内修复（1 处）。

## 5. 已知限制 / 后续
- 真实浏览器视觉/交互 dogfood 未自动化（无头浏览器被既有 Chrome 占用）；前端渲染逻辑已由 33 个字符串级测试覆盖，建议用户首次打开做一次视觉确认。
- `watch` 真实驱动用 `claude -p`（订阅 token）——§3.7 仅适用于无人值守自动化；当前为交互式、有人在场，风险低。
- 后续：daemon 化（移动/远程）、飞书载体适配器统一、字段级 diff 对照视图、长页面决策进度、Notification 离开回拉。

## 6. 关键文件
- 协议：src/protocol/{constants,schema,diff,attention,status}.mjs
- 基础设施：src/workspace.mjs
- 服务/回路：src/server/server.mjs · src/loop/{listener,claude-exec,session-store}.mjs
- 前端：src/render/{index.html,app.mjs,blocks.mjs,attention-view.mjs,diff-view.mjs,status-bar.mjs,md.mjs,app.css}
- 模板/CLI：templates/{think-discuss,dev-review}.mjs · bin/workbench.mjs
- 测试：tests/unit/*.test.mjs · tests/e2e/*.test.mjs
