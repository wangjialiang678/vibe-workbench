# vibecoding 工作台 · 通用人机交互层

把人机协作从「对话流」升级为**可插拔的共享工件**：AI 把每轮思考渲染成图文页（按内容类型选对表达：markdown / 架构图 / 选择 / 表态 / 可编辑文档），你在网页上**就地选择、批注、改写**，提交后 AI 被**异步唤醒**续跑。聊天框只是最弱的一种载体。

> 设计哲学：**编排注意力 > 渲染内容**。需你决策的上浮、无预设的最先、已设默认的下沉；多轮清楚标出"新增/改了什么"；AI 侧崩了网页也能自救。

## 快速开始

```bash
# 1. 跑测试（零依赖，Node ≥20）
npm test                         # 307 项单元/集成测试

# 2. 起服务（HTTP + 异步唤醒 listener）
node bin/workbench.mjs up --port 8099     # 默认只监听 127.0.0.1，serve + watch
#   或仅起 server：node bin/workbench.mjs serve --port 8099

# 3. 渲染一轮内容（AI 侧；content.json 见 docs/DESIGN.md §2）
node bin/workbench.mjs render <session> path/to/content.json
#   或从 stdin：echo '<json>' | node bin/workbench.mjs render <session> -

# 4. 浏览器打开
open "http://127.0.0.1:8099/render/?session=<session>&round=1"
```

提交反馈后，`watch` 的 listener 会自动认领并用 `claude -p --resume` 续跑，结果写回 `workspace/<session>/`，网页状态徽章变「已回复」。

## 公网部署与共享口令

本机行为不变：不设置 `WORKBENCH_TOKEN` 时只能监听 `127.0.0.1` 或 `localhost`。绑定其他地址必须设置共享口令，否则服务会拒绝启动：

```bash
# 云服务器上由 nginx 反代到这个端口；对外入口应使用 HTTPS
WORKBENCH_TOKEN='请换成足够长的随机值' \
  node bin/workbench.mjs up --host 0.0.0.0 --port 8099
```

- 页面通过 `?token=...` 进入；页面会把 token 自动透传给后续同源 API 请求。
- 脚本或 API 客户端优先使用请求头 `x-workbench-token`，也兼容 query 参数 `?token=...`。
- 渲染器自身的静态 JS/CSS/字体/图片可免口令加载；HTML、静态 `.json`/`.map`、所有 `/api/*` 及会话 `/assets/*` 均受保护。前端会给直接渲染的 `/assets/` iframe、图片和链接自动附加 query token。
- `present` 等需要访问本机 server 的 CLI 命令会自动读取 `WORKBENCH_TOKEN`；它返回的页面 URL 也会带 token。`wait` 只读本地文件，不发 HTTP 请求。
- HTML 与代理页面统一返回 `Referrer-Policy: no-referrer`，避免 token 随 Referer 发往下一跳；但 token 仍可能进入浏览器历史和反向代理访问日志。公网部署必须使用 HTTPS，并按实际安全要求处理日志和定期轮换口令。

## Hybrid 驱动与 SDK 托底标注

异步回路仍通过 `claude -p --resume` 驱动，但每轮采用两段式尝试：

1. 首跑不向子进程传 `ANTHROPIC_API_KEY`，让 Claude CLI 使用机器上的默认凭据。
2. 只有首跑非零退出或超时、且当前环境存在 `ANTHROPIC_API_KEY` 时，才显式传入该 key 重试一次。

首跑成功时 `status.json` 记录 `driverSource: "subscription"`；第二次尝试被使用时记录 `driverSource: "sdk-fallback"`，成功回复和网页状态区会明示“（本次由 SDK 托底执行，走 API 计费）”。这里的 “subscription” 与 “SDK 托底” 是工作台对两次**凭据尝试路径**的命名：工作台能保证首跑移除环境 key、回退时显式注入 key，但不能从 Claude CLI 进程外审计账号最终采用的认证来源或账单归属；本项目也没有新增 Anthropic SDK 依赖。

Claude CLI 的 stderr 写入错误状态前会脱敏 `ANTHROPIC_API_KEY=...` 和 `sk-ant-...` 形式的密钥，同时保留其余诊断上下文。

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
| `templates/` | think-discuss（思考共创/文档审阅）/ dev-review（PRD 审核·研发评审）/ design-review（UI·交互设计评审）—— 模板 = block 组合工厂 |
| `bin/workbench.mjs` | CLI：render / serve / watch / up（监管自愈） |

## 文档
- [docs/项目与技能说明.md](docs/项目与技能说明.md) · [网页版](docs/项目与技能说明.html) — **项目 + 技能总览（先看这个）**
- [docs/PRD.md](docs/PRD.md) — 需求与决策（D1-D8 / FR-1~FR-8）
- [docs/DESIGN.md](docs/DESIGN.md) — 完整设计（§13 为 UX 自审修订，含批次 6 落地标注）
- [docs/design/scenarios.md](docs/design/scenarios.md) — 用户场景
- [docs/research/2026-07-02-hci-clarification-community-and-project-review.md](docs/research/2026-07-02-hci-clarification-community-and-project-review.md) — 社区调研 + 独立设计评审
- [docs/test-plan.md](docs/test-plan.md) · [docs/delivery-report.md](docs/delivery-report.md) · [docs/feedback-log.md](docs/feedback-log.md) · [docs/dev-log.md](docs/dev-log.md)

## 状态
**307 项自动化测试全绿**。已落地：公网绑定防呆 + 共享口令门、hybrid CLI 驱动与 SDK 托底明示、§13 UX 自审（批次 6）、tab 六面分面导航（批次 7）、**user-vibeloop 实战反馈全量转化（批次 8 · DESIGN §16）**——
决策块结构化（背景/为什么/选项利弊/推荐理由 + 作者 lint）、会话级留言、live 实时系统标识、受众分层折叠、editable 一键确认、embed 代理支持 POST（实证 bug 修复）、prd-studio 高保真 UI 一键导入（手机壳呈现）。

**作者必读**：[docs/authoring-guide.md](docs/authoring-guide.md) —— 决策块不写背景/利弊，用户会盲选，产出伪决策。`present` 会硬校验决策块四段完整性；仅在明确使用 `--allow-incomplete-decisions` 时临时退回 lint 警告。

诚实缺口：真实浏览器 E2E 自动化套件仍缺（现靠 Playwright 手动 dogfood）；embed/proxy 尚无 SSRF allowlist；暗色对比度未做 WCAG 全面复核。
