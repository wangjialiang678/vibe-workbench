# vibecoding 工作台 · 通用人机交互层

把人机协作从「对话流」升级为**可插拔的共享工件**：AI 把每轮思考渲染成图文页（按内容类型选对表达：markdown / 架构图 / 选择 / 表态 / 可编辑文档），你在网页上**就地选择、批注、改写**，提交后 AI 被**异步唤醒**续跑。聊天框只是最弱的一种载体。

> 设计哲学：**编排注意力 > 渲染内容**。需你决策的上浮、无预设的最先、已设默认的下沉；多轮清楚标出"新增/改了什么"；AI 侧崩了网页也能自救。

> 🚀 **第一次用？看 [QUICKSTART.md](QUICKSTART.md)** —— 五分钟从 clone 到跑通第一轮（含 Claude Code / Codex / WorkBuddy 三选一的接入）。

## 快速开始

```bash
# 0. 让你的 AI 学会用工作台（Claude Code / Codex / WorkBuddy 自动探测）
bash integrations/install.sh

# 1. 跑测试（零依赖，Node ≥20）
npm test                         # 单元/集成测试

# 2. 起服务（HTTP + 异步唤醒 listener）
node bin/workbench.mjs up --port 8099     # 默认只监听 127.0.0.1，serve + watch
#   或仅起 server：node bin/workbench.mjs serve --port 8099

# 3. 渲染一轮内容（AI 侧；content.json 见 docs/DESIGN.md §2）
node bin/workbench.mjs render <session> path/to/content.json
#   或从 stdin：echo '<json>' | node bin/workbench.mjs render <session> -

# 4. 浏览器打开
open "http://127.0.0.1:8099/render/?session=<session>&round=1"

# 5.（可选）控制塔：多项目只读驾驶舱——各项目现状 + AI 刚做了什么 + 服务健康
open "http://127.0.0.1:8099/control?token=<WORKBENCH_TOKEN>"   # 仅管理员口令可访问
```

提交反馈后，`watch` 的 listener 会自动认领并唤醒你的 AI 续跑，结果写回 `workspace/<session>/`，网页状态徽章变「已回复」。用哪个 AI 由 `WORKBENCH_AGENT` 决定（`claude` / `workbuddy` / `codex`），不设则自动探测——详见 [integrations/README.md](integrations/README.md)。

## 架构与调试安全网

运行时代码按 `protocol → storage → core → adapters → render` 五层组织：protocol 是无 I/O 的共享规则，storage 是工作区唯一事实源，core 收敛跨入口用例，server/CLI/loop 是适配器，render 只消费 protocol。反馈自动续跑与 inbox 任务队列是两套独立状态机；`WB_CLOUD_AI` 默认关闭，开启方式见 [上线与启用云端 AI](docs/design/2026-08-30-架构重设计/05-上线与启用云端AI.md)。

三条结构守卫持续检查分层无环、文件系统边界和零依赖；`node scripts/ab-compare.mjs` 则把当前 HTTP 行为与冻结基线逐项对拍。排查现场时以 `workspace/<session>/` 的状态文件为准，`journal.jsonl` 仅追加记录轮次、反馈与 worker 生命周期，方便串联诊断而不成为第二事实源。

## 公网部署与共享口令

本机行为不变：不设置 `WORKBENCH_TOKEN` 时只能监听 `127.0.0.1` 或 `localhost`。绑定其他地址必须设置共享口令，否则服务会拒绝启动：

```bash
# 云服务器上由 nginx 反代到这个端口；对外入口应使用 HTTPS
WORKBENCH_TOKEN='请换成足够长的随机值' \
  node bin/workbench.mjs up --host 0.0.0.0 --port 8099
```

- 页面通过 `?token=...` 进入；页面会把 token 自动透传给后续同源 API 请求。
- 脚本或 API 客户端优先使用请求头 `x-workbench-token`，也兼容 query 参数 `?token=...`。
- 渲染器自身的静态 JS/CSS/字体/图片可免口令加载；HTML、静态 `.json`/`.map`、所有 `/api/*` 及会话 `/assets/*` 均受保护。参与者的会话资产清单和直读还必须能追溯到当前身份可见的 block；同一资产只要被公共块引用就按公共可见放行。前端会给直接渲染的 `/assets/` iframe、图片和链接自动附加 query token。
- `present` 等需要访问 server 的 CLI 命令会自动读取 `WORKBENCH_TOKEN`；它返回的页面 URL 也会带 token。未配置远程模式时，`wait` 仍只读本地文件。
- HTML 与代理页面统一返回 `Referrer-Policy: no-referrer`，避免 token 随 Referer 发往下一跳；但 token 仍可能进入浏览器历史和反向代理访问日志。公网部署必须使用 HTTPS，并按实际安全要求处理日志和定期轮换口令。

### 个人专属邀请链接

`WORKBENCH_TOKEN` 仍是管理员口令。管理员可为每位参与者生成独立 magic-link；私密名册写入已被 gitignore 的 `config/participants.json`，`list` 与管理 API 都不会回显 token：

```bash
workbench participant add alice 小艾       # 返回完整 /render/?token=... 邀请链接
workbench participant list                  # 只显示 id / name / createdAt
workbench participant revoke alice          # 立即吊销该链接
```

参与者 token 可进入页面和普通 API，但 `/api/participants` 的新增、列表、吊销只接受管理员口令。多人在同一轮提交时分别写入 `feedback-<id>.json`，首份提交同时建立 `feedback.json` 兼容桥，既有 `wait` / listener 会被第一份反馈立即唤醒；管理员反馈仍写 `feedback.json` 并在聚合视图中优先。页面会在对应块下只读显示各人意见，`select` 选择不同时标注「意见分歧」。

块可选 `assignee` 字段指定责任人 ID：省略、`null` 或空串表示公共块；有值时仅该参与者与管理员可见。服务端按块过滤内容、跨轮 diff/历史响应标记、feedback 与会话流引用，并拦截参与者对不可见或未知块的反馈提交。参与者不能调用 `/api/retry`；吊销名册 token 后后续请求立即失效。

### 让本地 CLI 使用云端 workspace

设置 `WORKBENCH_REMOTE_URL` 后，`present` / `wait` 与 `participant add/list/revoke` 切到远程 API；`render`、`serve`、`watch`、`up` 不变。云端因此成为该会话和参与者名册的唯一事实源，本地不会再写一份副本。`wait --events` 会同时监听反馈和启动后新增的会话流事件；不加该参数时行为与原版完全一致。

首次远程 `present` 会同步创建 `session.json`，默认写入本轮标题、`kind:"work"` 和 `status:"active"`。若会话没有命中项目注册表，也没有有效的 `session.json.projectId`，服务端仍成功创建，但响应附带“未归属项目的新会话” warning；CLI 会把它打印到 stderr，该会话同时进入页面“待归类”区。

```bash
export WORKBENCH_REMOTE_URL='https://workbench.example.com'
export WORKBENCH_TOKEN='与云端一致的共享口令'

node bin/workbench.mjs present <session> content.json
node bin/workbench.mjs wait <session> <round>
node bin/workbench.mjs wait <session> <round> --events
node bin/workbench.mjs stream-migrate <session>   # 历史 sessionComment 幂等迁移
```

每个会话的消息、AI 回执和进度以 JSONL 追加到 `workspace/<session>/stream.jsonl`。`POST /api/messages` 使用已认证的 owner/participant 实名，`GET /api/messages?session=&since=` 支持 ID 或时间游标；参与者收到的 refs 会按 block 可见性裁剪，隐藏 ask 及其 answer 不返回，回答 ask 时服务端重新验证关联 block。轮次与反馈成功后自动写 AI 回执。管理员可通过 `POST /api/stream-events` 以 AI 身份写 `message` / `progress` / `receipt`。`POST /api/attachments?session=` 接受不超过 5 MiB 的 PNG/JPEG/WebP/GIF/PDF，保存到 `assets/uploads/` 并由既有受保护 `/assets/` 路由读取。

会话文档保存在 `workspace/<session>/documents/<category>/<slug>.md`，分类限于「需求 / PRD / 架构 / UI 设计 / 交互设计 / 测试 / 其他」，正文上限 256 KiB（按 UTF-8 字节）。管理员可用 `POST /api/documents` 发布或更新；`GET /api/documents?session=...` 返回列表，增加 `slug=...` 返回单篇正文，跨分类出现同名 slug 时可再传 `category=...` 消歧。CLI 会优先采用源文件 frontmatter 的 `title`，否则用文件名，也可显式覆盖：

```bash
workbench doc-publish <session> <category> <slug> <md文件路径> [--title 标题]
```

设置 `WORKBENCH_REMOTE_URL` 时该命令与 `present` 一样只写远程工作台；每次发布或更新都会向会话流追加「文档已更新」回执。

文档库始终以 Markdown 文件作为单一信息源，不另存一份容易漂移的 HTML；阅读页在浏览器端按需生成安全的语义化 HTML。GFM 表格会渲染为带表头、对齐和边框的表格，窄屏上可横向滚动。

可选设置 `WORKBENCH_EVENT_WEBHOOK`。服务端在新轮次成功落盘、反馈成功提交或新消息落流后，分别异步 POST `round-presented` / `feedback-submitted` / `message-posted` 事件；单次投递 5 秒超时，失败只记日志，不改变主请求结果。

常驻 worker 默认只在 `127.0.0.1:8097` 接收事件推送（可用 `WORKER_EVENT_PORT` 改端口），并保留 60 秒一次的低频轮询兜底（可用 `POLL_MS` 调整）。必须在工作台 **server 进程的环境**中把 `WORKBENCH_EVENT_WEBHOOK` 设为 `http://127.0.0.1:8097/events`；只设置 worker unit 不会启用服务端投递。配置后，新轮次、反馈或消息落盘会立即唤醒指定 session；监听不做额外鉴权，因为固定绑定本机回环地址。webhook 单次投递 5 秒超时，失败只记日志，不改变主请求结果。

worker 每 30 秒用管理员口令向 `POST /api/worker-heartbeat` 上报一次存活状态；`GET /api/status` 返回 `workerOnline` 和 `workerLabel`，超过 90 秒未收到心跳才视为云端 AI 离线。同一轮反馈使用 `round@submittedAt` 去重，因此重新提交不会被旧轮次游标吞掉。

Codex 超时或非零退出后，worker 只检查本次项目路由的仓库根目录。若存在未提交改动，会创建 `codex-timeout-<UTC时间戳>` 分支，用包含 session/中断原因的中文提交保存全部改动，再切回原分支并确认干净；回执给出切换快照分支的续跑命令。非 Git 目录、工作台 `workspace/` 数据目录一律跳过；任一 Git 操作失败都会停止后续清理并在回执中说明，保留现场供人工处理。

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
| `src/participants.mjs` | 私密参与者名册：magic-link token、脱敏列表、即时吊销 |
| `src/stream.mjs` | append-only 会话流：消息/回执/进度、增量读取、历史留言迁移 |
| `src/documents.mjs` | 会话文档库：分类/slug 校验、frontmatter、列表/单篇读取与更新 |
| `src/workspace.mjs` | 文件契约与共享轮次写入（content/feedback/ack/response/error/status） |
| `src/server/` | 零依赖 HTTP + API（rounds / feedback / messages / stream-events / attachments / worker-heartbeat / webhook） |
| `src/loop/` | 异步唤醒 listener（对账幂等 + 独立心跳 + 容错）/ claude-exec / session-store |
| `scripts/resident-worker.mjs` | 云端常驻 worker（本机 webhook 推送 + 60 秒兜底轮询 + 30 秒在线心跳） |
| `src/render/` | 前端：桌面会话流分栏 / 手机三标签 + 纯函数 HTML 渲染 + 四区注意力 + diff 徽章 + 状态/重试 |
| `templates/` | think-discuss（思考共创/文档审阅）/ dev-review（PRD 审核·研发评审）/ design-review（UI·交互设计评审）—— 模板 = block 组合工厂 |
| `bin/workbench.mjs` | CLI：render / present / wait --events / stream-migrate / participant / serve / watch / up |

## 文档
- [docs/项目与技能说明.md](docs/项目与技能说明.md) · [网页版](docs/项目与技能说明.html) — **项目 + 技能总览（先看这个）**
- [docs/operations/resident-codex-runbook.md](docs/operations/resident-codex-runbook.md) — 常驻 Codex 当前拓扑、故障语义、高可用目标与安全恢复清单
- [docs/control-tower.md](docs/control-tower.md) — 控制塔（`/control`）：只读驾驶舱、projects.json 的 `controlTower` 配置契约、访问边界
- [docs/PRD.md](docs/PRD.md) — 需求与决策（D1-D8 / FR-1~FR-8）
- [docs/DESIGN.md](docs/DESIGN.md) — 完整设计（§13 为 UX 自审修订，含批次 6 落地标注）
- [docs/design/scenarios.md](docs/design/scenarios.md) — 用户场景
- [docs/research/2026-07-02-hci-clarification-community-and-project-review.md](docs/research/2026-07-02-hci-clarification-community-and-project-review.md) — 社区调研 + 独立设计评审
- [docs/test-plan.md](docs/test-plan.md) · [docs/delivery-report.md](docs/delivery-report.md) · [docs/feedback-log.md](docs/feedback-log.md) · [docs/dev-log.md](docs/dev-log.md)

## 状态
**459 项自动化测试全绿**。已落地：桌面会话流分栏与手机三标签、append-only 会话流前后端、事件化 wait、受保护附件上传、历史留言迁移、公网绑定防呆 + 管理员/个人专属链接口令门、逐人反馈与分歧标注、远程会话服务与事件 webhook、hybrid CLI 驱动与 SDK 托底明示、§13 UX 自审（批次 6）、tab 六面分面导航（批次 7）、**user-vibeloop 实战反馈全量转化（批次 8 · DESIGN §16）**——
决策块结构化（背景/为什么/选项利弊/推荐理由 + 作者 lint）、会话级留言、live 实时系统标识、受众分层折叠、editable 一键确认、embed 代理支持 POST（实证 bug 修复）、prd-studio 高保真 UI 一键导入（手机壳呈现）。

**作者必读**：[docs/authoring-guide.md](docs/authoring-guide.md) —— 决策块不写背景/利弊，用户会盲选，产出伪决策。`present` 会硬校验决策块四段完整性；仅在明确使用 `--allow-incomplete-decisions` 时临时退回 lint 警告。

诚实缺口：真实浏览器 E2E 自动化套件仍缺（现靠 Playwright 手动 dogfood）；embed/proxy 尚无 SSRF allowlist；暗色对比度未做 WCAG 全面复核。
