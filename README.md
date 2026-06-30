# vibecoding 工作台 · 通用人机交互层

把人机协作从「对话流」升级为**可插拔的共享工件**：AI 把每轮思考渲染成图文页（按内容类型选对表达：markdown / 架构图 / 选择 / 表态 / 可编辑文档），你在网页上**就地选择、批注、改写**，提交后 AI 被**异步唤醒**续跑。聊天框只是最弱的一种载体。

> 设计哲学：**编排注意力 > 渲染内容**。需你决策的上浮、无预设的最先、已设默认的下沉；多轮清楚标出"新增/改了什么"；AI 侧崩了网页也能自救。

## 快速开始

```bash
# 1. 跑测试（零依赖，Node ≥20）
npm test                         # 118 单元/集成测试

# 2. 起服务（HTTP + 异步唤醒 listener）
node bin/workbench.mjs up --port 8099     # serve + watch（监管自愈）
#   或仅起 server：node bin/workbench.mjs serve --port 8099

# 3. 渲染一轮内容（AI 侧；content.json 见 docs/DESIGN.md §2）
node bin/workbench.mjs render <session> path/to/content.json
#   或从 stdin：echo '<json>' | node bin/workbench.mjs render <session> -

# 4. 浏览器打开
open "http://127.0.0.1:8099/render/?session=<session>&round=1"
```

提交反馈后，`watch` 的 listener 会自动认领并用 `claude -p --resume` 续跑，结果写回 `workspace/<session>/`，网页状态徽章变「已回复」。

## 架构（三段式「桥」）

```
[ 你 ] ⇄ [ 载体 网页 ] ⇄ [ 内容协议 blocks+feedback ] ⇄ [ 桥 异步唤醒 ] ⇄ [ 接入 CLI ] ⇄ [ Claude ]
         可插拔适配器        不变内核（协议+触发+续接）                 可插拔
```

| 目录 | 职责 |
|---|---|
| `src/protocol/` | 内容协议：constants / schema / **diff**（轮次差异）/ **attention**（注意力路由）/ **status**（状态联合判定） |
| `src/workspace.mjs` | 文件契约（content/feedback/ack/response/error/status） |
| `src/server/` | 零依赖 HTTP + API（content 注入 diff / feedback / status / retry） |
| `src/loop/` | 异步唤醒 listener（对账幂等 + 独立心跳 + 容错）/ claude-exec / session-store |
| `src/render/` | 前端：纯函数 HTML 渲染 + 四区注意力 + diff 徽章 + 状态/重试 |
| `templates/` | think-discuss（思考共创）/ dev-review（研发评审）—— PRD 工作台只是一个模板 |
| `bin/workbench.mjs` | CLI：render / serve / watch / up（监管自愈） |

## 文档
- [docs/PRD.md](docs/PRD.md) — 需求与决策（D1-D8 / FR-1~FR-8）
- [docs/DESIGN.md](docs/DESIGN.md) — 完整设计（§13 为 UX 自审修订）
- [docs/design/scenarios.md](docs/design/scenarios.md) — 用户场景
- [docs/test-plan.md](docs/test-plan.md) · [docs/delivery-report.md](docs/delivery-report.md) · [docs/feedback-log.md](docs/feedback-log.md)

## 状态
MVP 全量实现完成，118 自动化测试 + 端到端集成全绿。后续：真实浏览器视觉 dogfood、daemon 化（无人值守/移动）、飞书载体适配器、FR-7/8 进阶项（字段级 diff 视图、长页面进度、Notification）。
