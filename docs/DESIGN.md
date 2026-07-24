# DESIGN — 通用人机交互层（vibecoding 工作台）

> 交互体验设计师视角的完整设计。配套 [PRD.md](PRD.md)。本文件是实现的权威规格（schema / 算法 / 文件契约 / UI 状态全部具体到可实现）。

## 0. 设计目标（体验优先级）

1. **编排注意力 > 渲染内容**：用户注意力是最稀缺资源。默认正确的下沉、需决策的上浮、无推荐的最先（FR-7）。
2. **不丢、不黑洞**：提交永不丢失；AI 侧任何异常用户都能从网页看到状态并自救（FR-6）。
3. **多轮不迷路**：每轮清楚标出"哪些是新的/变了的"（FR-8）。
4. **按语义选表达**：架构→图、流程→时序、选择→控件，而非纯文本（D5）。
5. **零依赖、可自举**：前端零框架、后端零依赖，复用已验证积木。

---

## 1. 目录结构

```
vibecoding 工作台/
├── docs/                 PRD.md · DESIGN.md · design/scenarios.md · test-plan.md · dev-log.md · feedback-log.md
├── src/
│   ├── protocol/         schema.mjs(校验) · diff.mjs(轮次diff) · attention.mjs(注意力路由排序)
│   ├── server/           server.mjs(零依赖 HTTP + API)
│   ├── loop/             listener.mjs(异步唤醒+对账) · claude-exec.mjs(驱动 claude -p --resume) · session-store.mjs
│   └── render/           (前端) index.html · app.mjs · blocks.mjs(各 block 渲染) · attention-view.mjs · diff-view.mjs · status-bar.mjs · app.css
│       └── vendor/       mermaid.min.js（从 prd-studio 复制，本地化）
├── templates/            think-discuss.mjs · dev-review.mjs（模板=block 组合工厂）
├── workspace/            运行时数据（gitignore）：<session>/round-<n>/...
├── tests/                unit/ · e2e/
├── bin/                  workbench.mjs（CLI：起 server+listener、渲染一轮、等待）
└── package.json
```

技术栈：Node ≥20 ESM、零运行时依赖（仅内置 http/fs/path/crypto + 测试用 node:test）。前端原生 JS + 本地 mermaid。

---

## 2. 内容协议（核心 · FR-1）

### 2.1 一轮内容 `content.json`

```jsonc
{
  "session": "ses_xxx",          // 会话 id（= 一条人机对话线）
  "round": 2,                    // 轮次，从 1 起
  "prevRound": 1,                // 上一轮号，用于 diff；首轮为 0
  "title": "本轮主题",
  "template": "think-discuss",   // think-discuss | dev-review | null(即兴)
  "createdAt": "ISO",
  "blocks": [ Block, ... ]
}
```

并行落 `content.md`（人读/单一信息源，由 blocks 线性序列化）。

### 2.2 Block 通用结构

```jsonc
{
  "id": "b-decision-trigger",    // 跨轮稳定 id（diff 依赖；同一议题保持同 id）
  "type": "markdown",            // 见 2.3
  "section": "架构",             // 可选：tab 分面类目（§15）；任一块带 section 即启用 tab 导航
  "title": "可选标题",
  "body": "...",                 // markdown / mermaid 源 / 提示文案（按 type 释义）

  // —— 注意力元数据（FR-7，渲染器据此分区排序）——
  "needsDecision": false,        // 是否需要用户做决策/操作
  "hasRecommendation": false,    // 是否带推荐答案/默认
  "recommendation": null,        // 推荐值（optionId / 文本 / verdict）
  "importance": "normal",        // high | normal | low
  "default": null,               // 预填默认（无需决策项的既定值，用户同意即跳过）
  "assignee": null,              // 可选责任人 ID；省略/null/空串=公共块

  // —— 类型特定字段见 2.3 ——

  // —— diff 字段（FR-8，运行时计算，作者不填）——
  "_change": "unchanged"         // new | changed | unchanged
}
```

### 2.3 Block 类型与字段

| type | 额外字段 | 渲染 | 可反馈 |
|---|---|---|---|
| `markdown` | — | markdown→HTML | 评论 |
| `diagram` | `lang:"mermaid"`, `body`=源 | mermaid→SVG，下方可折叠 `rationale` | verdict + 评论 |
| `choice` | `options:[{id,label,desc?}]`, `multi:bool`, `recommendation:optionId` | 单/多选控件，推荐项标「推荐」 | select(必填若 needsDecision) + 评论 |
| `verdict` | — | ✓赞成/✗异议/?疑问 三按钮 | verdict + 评论 |
| `freetext` | `placeholder?` | 文本输入框 | text + 评论 |
| `editable` | `value`(markdown), `editable:true` | 就地可编辑文档块（textarea/contenteditable，保存为新 value） | edit + 评论 |
| `table` | `columns:[], rows:[[]]` | 表格 | 评论 |
| `code` | `lang`, `body` | 代码块（高亮） | 评论 |

评论层（comment）对所有 block 通用：每块右侧「+批注」。

### 2.4 反馈 `feedback.json`

```jsonc
{
  "session":"ses_xxx", "round":2, "submittedAt":"ISO",
  "items":[
    {"blockId":"b-x","type":"select","value":"opt-2","comment":"理由…"},
    {"blockId":"b-y","type":"verdict","value":"疑问","comment":"…"},
    {"blockId":"b-z","type":"edit","value":"用户改写后的 markdown"},
    {"blockId":"b-w","type":"comment","value":null,"comment":"批注…"}
  ],
  "summary":"总评（可选）"
}
```

服务端并写 `feedback.md`（人读）。

---

## 3. 渲染器（FR-2）

- `blocks.mjs`：导出 `renderBlock(block) -> HTMLElement`，按 type 分派；纯函数、无副作用、可单测（jsdom-free：用字符串/DOM 断言）。
- markdown：Markdown 是持久化的单一信息源，浏览器按需派生安全 HTML；内置 md→HTML 支持标题/列表/粗体/代码/换行/链接/图片和 GFM 表格（含对齐与窄屏横向滚动），避免外部依赖。
- diagram：输出 `<pre class="mermaid">{src}</pre>`，页面加载后 `mermaid.run()`；`rationale` 折叠。
- choice/verdict/freetext/editable：受控控件，状态写入 localStorage 草稿（键 `wb:<session>:<round>:fb`）。
- 每个 block 外层带 `data-block-id`、`data-change`（diff）、`data-zone`（注意力分区）。

---

## 4. 注意力路由（FR-7 · 分区排序算法）

`attention.mjs` 导出 `routeBlocks(blocks) -> { zoneA, zoneB, zoneC }`：

```
zoneA = blocks.filter(b => b.needsDecision && !b.hasRecommendation)   // 需决策·无推荐：最先
zoneB = blocks.filter(b => b.needsDecision &&  b.hasRecommendation)   // 需决策·有推荐
zoneC = blocks.filter(b => !b.needsDecision)                          // 已设默认·FYI
```

- 区内排序：`importance` 降序（high>normal>low），同级 **稳定排序**（保留作者顺序）。
- 渲染：
  - **区 A**：页面顶部，醒目（左侧红条 + 「需你定·无预设」徽章）。
  - **区 B**：其次（左侧橙条 + 「需你定·有推荐」徽章，推荐项预选浅色高亮）。
  - **区 C**：底部折叠区「已为你设好默认（N 项）· 展开查看」，默认收起。
- 顶部状态条显示：`需你决策 X 项（其中 Y 项无预设）`，点击锚点跳转区 A。
- 单测点：给定混合 blocks，断言三区归属与区内排序正确。

---

## 5. 轮次差异 Diff（FR-8）

`diff.mjs` 导出 `computeDiff(curBlocks, prevBlocks) -> curBlocks(带 _change)`：

```
对每个 cur block 按 id 在 prev 中查找：
  无 → _change="new"
  有 → 比较内容指纹 hash(type+title+body+options+recommendation+default)
        不同 → "changed"；相同 → "unchanged"
```

- 指纹用 `crypto.createHash('sha1')`，稳定序列化字段。
- 渲染：`new`→绿色「NEW」徽章；`changed`→橙色「CHANGED」徽章 + 可展开「看上轮」对照；`unchanged`→无徽章。
- 顶部开关「只看变更」：过滤仅显示 new/changed（解决"老内容淹没新内容"）。
- prevBlocks 来源：`workspace/<session>/round-<prevRound>/content.json`。
- 单测点：增、改、删、未变四种情形 _change 正确；只看变更过滤正确。

---

## 6. 容错与恢复（FR-6 · 状态机 + 文件契约）

### 6.1 每轮状态机（`status.json`）

```
rendered ──(用户POST)──► submitted ──(listener认领写ack)──► claimed ──(AI写response)──► responded
                              │                                              │
                              │                                       (AI异常写error)
                              └──────────────────────────────────────────► error
listener 心跳过期 ⇒ 前端显示 offline（提交已存，恢复后自动处理；非独立状态，由心跳新鲜度推导）
```

`workspace/<session>/status.json`：
```jsonc
{ "session":"ses_x","round":2,"state":"submitted",
  "heartbeatAt":"ISO",            // listener 每 10s 刷新
  "error":null,                   // error 状态时填 {message, at}
  "updatedAt":"ISO" }
```

### 6.2 文件契约（异步唤醒回路核心）

```
workspace/<session>/
  session.json                 { session,title,projectId?,kind,status,...执行器兼容字段 }
  status.json                  当前状态 + 心跳
  round-<n>/
    content.json / content.md  AI 渲染的一轮（state=rendered）
    feedback.json / .md        用户提交（state=submitted；持久，不删）
    ack.json                   listener 认领凭证 { claimedAt, pid }（幂等锁）
    response.md                AI 续跑产出（state=responded）→ 同时生成 round-<n+1>/content.*
    error.json                 AI 异常 { message, at }（state=error）
```

### 6.3 自愈与对账

- **持久 + 幂等**：feedback.json 落盘即 durable；listener 认领前先写 ack.json（存在则跳过，防重复处理）。
- **启动对账（reconcile）**：listener 启动时扫描所有 `round-*/feedback.json` 且无 `ack.json`、无 `response.md` 的轮 → 补处理。崩溃重启自动补上。
- **监管自愈**：`bin/workbench.mjs` 以子进程方式起 listener，监测退出码 → 自动重启（≤N 次）；listener 内部 try/catch 单轮异常 → 写 error.json，不拖垮进程。
- **心跳**：listener 每 10s 写 `status.heartbeatAt`；前端轮询发现 `now - heartbeat > 30s` → 显示 🔴 离线。

### 6.4 网页状态徽章 + 恢复动作

`status-bar.mjs` 轮询 `GET /api/status?session=` 每 3s，显示：
- 🟢 在线（监听中）/ 🟡 处理中（claimed）/ 🔵 已回复（responded，提示"已生成新一轮，点击查看"）/ 🔴 AI 离线（提交已保存，恢复后自动处理）/ ⚠️ 出错（显示 error.message + 「重试」）
- **重试按钮**：`POST /api/retry?session=&round=` → 删除该轮 ack.json/error.json、状态回 submitted → listener（或重启后对账）重新处理。用户全程不需回 IDE。

---

## 7. 异步唤醒回路（FR-4 · D7）

时序（已在需求确认阶段实证）：
```
AI 渲染 content → 结束回合 + listener 监听 → 用户提交(POST→feedback.json,state=submitted)
→ listener 检测→写 ack→ claude -p --resume <sid> "<结构化反馈>" → 写 response.md + 下一轮 content
→ 更新 status=responded → 前端轮询到→提示查看
```

- **IDE 内**：listener 由 `bin/workbench.mjs` 拉起；它检测到 responded 也可（可选）通过控制台输出提醒主 Claude。MVP 内核心 = 文件契约，driver 可换。
- **接入**：`claude-exec.mjs` 封装 `claude -p <prompt> --output-format stream-json [--resume <sid>]`，cwd=会话工作目录；首轮无 sid，从输出捕获 session_id 存 `session.json`，后续 --resume。
- **超时兜底**：listener 对单轮处理设软超时，超时写 error，前端可重试。
- **D3 阶段② hybrid 托底**：默认尝试从子进程环境移除 `ANTHROPIC_API_KEY`，使用 Claude CLI 的机器默认凭据；仅当该尝试非零退出或超时且环境存在 key 时，显式传 key 重试一次。状态落 `driverSource: "subscription" | "sdk-fallback"`；托底回复与状态区写固定中文标注。字段只证明工作台采用了哪条凭据尝试路径，不能从 CLI 外部证明最终认证来源或账单归属；当前没有直接接入 Anthropic SDK。子进程 stderr 进入错误状态前脱敏 `ANTHROPIC_API_KEY=...` 与 `sk-ant-...` 密钥串。

---

## 8. Server API（`server/server.mjs`，零依赖）

| 方法 路径 | 作用 |
|---|---|
| GET `/` 及静态 | 托管 src/render/ |
| POST `/api/rounds` | 校验并独占写入新轮次；2 MiB 上限；重复 round 返回 409 |
| GET/POST `/api/messages` | 读取会话流（支持 ID/时间 `since`）/ 以请求身份追加实名消息 |
| POST `/api/stream-events` | 仅管理员以 AI 身份追加 `message` / `progress` / `receipt` |
| POST `/api/attachments?session=` | 上传 ≤5 MiB PNG/JPEG/WebP/GIF/PDF 到该会话 `assets/uploads/` |
| GET `/api/content?session=&round=` | 返回该轮 content.json（含 diff `_change`，服务端注入） |
| POST `/api/feedback` | owner 写 feedback.json/.md；参与者写 feedback-<id>.json 并给首份建立兼容桥；任一首份使 status=submitted |
| GET `/api/feedback?session=&round=` | 返回 owner 优先的 `feedback`、`byParticipant` 与 select `conflicts`；无反馈则 HTTP 200 + `pending:true` |
| GET `/api/status?session=` | 返回 status.json、本地驱动心跳新鲜度，以及 `workerOnline` / `workerLabel` |
| POST `/api/worker-heartbeat` | 仅口令门内管理员可写；记录常驻 worker 的 `{at,label?}`，90 秒未更新即离线 |
| POST `/api/retry?session=&round=` | 重置该轮为 submitted（清 ack/error） |
| GET `/api/sessions` | 列出 workspace 下会话（dev 用） |
| GET/POST `/api/participants` | 管理员脱敏列表 / 新增参与者并返回完整邀请链接 |
| DELETE `/api/participants/:id` | 管理员吊销参与者 magic-link |
| GET `/api/health` | `{ok,ts}` |

服务端在返回 content 时调用 `diff.computeDiff` 注入 `_change`、`attention.routeBlocks` 可前端做（前端做，便于"只看变更"交互）。

公网绑定默认防呆：`serve/up --host` 默认仍为 `127.0.0.1`；非 `127.0.0.1/localhost` 监听必须设置 `WORKBENCH_TOKEN`。该 token 解析为 `{id:'owner',name:'管理员',role:'owner'}`；`config/participants.json` 中的个人 token 解析为 `{id,name,role:'participant'}`，名册每请求读取以保证吊销立即生效。启用口令门后页面入口使用 `?token=`，API 接受 `x-workbench-token` 或 `?token=`，会话 `/assets/*` 只接受 query token；管理员和参与者都可进入普通页面/API，但参与者管理 API 仅 owner 可用。根跳转和 embed 代理只透传本次已验证的来访 token，绝不把管理员口令替换给参与者。页面把入口 query 中的 token 透传到后续同源 API及直接渲染的 `/assets/` 资源；本机 CLI 在环境存在 token 时自动附带。只豁免渲染器自身的 JS/CSS/字体/图片，`.json`/`.map` 不豁免；所有 HTML/代理页面响应统一带 `Referrer-Policy: no-referrer`。

参与者名册格式为 `[{id,name,token,createdAt}]`，写入采用同目录临时文件 + rename，token 为 16 个密码学随机字节的十六进制表示。CLI `participant add/list/revoke` 在本地直接维护名册；配置 `WORKBENCH_REMOTE_URL` 后复用管理 API。只有 add/API 创建响应包含一次性可分发的完整邀请链接，list 永不回显 token。

逐人反馈：服务端覆盖客户端传入的 `submittedBy`，参与者反馈写 `feedback-<id>.json`；第一份同步写规范 `feedback.json`，让旧 listener 与 `wait` 保持“首份即唤醒”。owner 后交时覆盖规范文件，并成为 GET 的合并主视图；`byParticipant` 始终保留逐人提交。参与者可在 claimed 后补交自己的文件，但不得把 claimed/responded/error 状态倒退；owner 仍沿用 claimed 时 409。冲突只比较同 block 的 `type:'select'`，不同参与者值不一致时返回 `conflicts:[{blockId,choices}]`。

会话流：`workspace/<session>/stream.jsonl` 是 append-only 消息档案，每行包含 `id/at/author/kind/text/refs?`。普通消息作者取认证身份，AI 回执/进度作者固定为 `ai`；rounds 与 feedback 成功后分别自动写“已出第 N 轮”和“某人已提交第 N 轮反馈”。历史规范 `feedback.json` 的非空 `sessionComment` 可用 `stream-migrate` 幂等迁入。

远程 CLI：设置 `WORKBENCH_REMOTE_URL` 后，`present` 把完整 content POST 到云端，默认 `wait` 每 3 秒轮询云端 feedback；显式 `wait --events` 同时增量轮询 messages，任一新事件即返回。`participant` 子命令调用云端管理 API；轮次分配、反馈和名册持久化只发生在云端。未设置时继续走本地文件流程。`--allow-incomplete-decisions` 映射为 `allowIncomplete=1`，页面 URL 由 CLI 使用远程基址构造并附带 token query。服务端首轮成功后合并写入会话标题、`kind:"work"`、`status:"active"`；项目 ID、主会话、别名或既有 `session.json.projectId` 命中注册项目时保留/写入归属，否则成功响应附带 warning，CLI 写 stderr，会话按既有目录规则显示为“待归类”。

事件通知：设置 `WORKBENCH_EVENT_WEBHOOK` 后，服务端在轮次成功落盘、feedback 成功落盘和 message 成功落流后异步 POST 最小事件 JSON。云端常驻 worker 固定在 `127.0.0.1:WORKER_EVENT_PORT`（默认 8097）接收这些事件并立即检查指定 session；60 秒全量轮询仅用于 webhook 丢失兜底。投递使用 5 秒超时；网络错误、非 2xx 和超时只写日志，不回滚落盘，也不改变主请求响应。worker 另以 30 秒周期写管理员心跳，页面优先据此展示云端 AI 在线状态。

Codex 子进程超时或非零退出时，worker 仅对本次 `executionContext.primaryProject.repoPath` 做 Git 善后。候选真实路径必须恰好等于 Git 顶层目录，并避开默认及 `WB_WORKSPACE` 指定的数据目录；脏工作区封存到 `codex-timeout-<UTC时间戳>` 后切回原分支。非 Git、受保护路径或 Git 失败都不会转而操作 worker 常驻目录，结果通过对话流 receipt 如实返回。

远程写入的 session 限 80 字符且必须匹配 `/^[A-Za-z0-9._-]+$/`（另拒绝 `.` / `..`）。服务端对点号 session 使用精确目录，避免与下划线名称碰撞；本地默认路径仍兼容旧版“点号转下划线”的既有 workspace，精确目录一旦存在则自动跟随。

---

## 9. 视觉与交互设计语言

- 克制、信息优先：浅色为主 + 暗色切换（复用 prd-studio CSS 变量）。强调色仅用于注意力分区（红=需定无预设、橙=需定有推荐/CHANGED、绿=NEW、蓝=已回复）。
- 顶部固定状态条：左=会话/轮次 + 会话列表 + 可选「设计资产」+ diff 开关「只看变更」；右=AI 状态徽章 + 「提交」。`content.meta.docsUrl` 为字符串时显示设计资产链接；同源链接才继承 token，外站不携口令。
- 分区视觉：区 A/B 卡片带左色条 + 徽章；区 C 折叠。
- 移动友好：单列、viewport-fit、控件触摸尺寸（为 phase 2 飞书/移动载体铺路）。
- 草稿即时存 localStorage，防丢。
- 每 3 秒只刷新块下的逐人只读意见，不重渲表单、草稿、焦点和 tab；select 分歧同时显示文字角标，不能只靠颜色。

---

## 10. 两个模板（D6）

模板 = 产出 blocks 的工厂函数（`templates/*.mjs`）：
- `think-discuss(input) -> blocks[]`：思考共创。典型块：markdown(思路) + diagram(结构/时序) + choice/verdict(决策点，带 needsDecision/recommendation/importance) + editable(可改文档) + 评论。**本项目这几轮的确认过程即此模板。**
- `dev-review(spec) -> blocks[]`：研发评审。复刻现 prd-studio 能力：PRD 条目(verdict) + 架构(diagram+assertions) + 测试场景。证明"prd-studio = 本框架一个模板"。

两模板共用 §4 注意力路由、§5 diff、§6 容错、§3 渲染器——验证通用性。

---

## 11. 测试策略（FR：全自动化，跑绿）

- **unit**（node:test）：
  - protocol/schema：合法/非法 content 校验
  - attention.routeBlocks：分区归属 + 区内重要性排序
  - diff.computeDiff：new/changed/unchanged/删除 + 只看变更
  - blocks.renderBlock：各 type 输出关键 DOM 结构/属性（用轻量 DOM 断言，不引浏览器）
  - templates：两模板产出结构正确
  - session-store / claude-exec：argv 组装含 --resume、session_id 捕获（mock 子进程）
- **e2e/scenario**（起真 server + 文件契约，不依赖真 claude）：
  - 提交→feedback 落盘→status=submitted
  - listener 对账：放一个无 ack 的 feedback → 运行对账 → 产生 ack/response（用 mock driver）
  - 容错：模拟 listener 崩溃（不写 ack）→ 重启对账补处理；retry 重置状态
  - 心跳过期→status 接口反映 offline
- 全部 `npm test` 跑绿；P0：依赖(无)、ESM 可加载、server 起得来、主流程冒烟。

---

## 12. 关键设计决策记录（自决项）

- **协议字段命名**`needsDecision/hasRecommendation/importance` 直白可读，渲染器一一映射注意力分区。
- **diff 用 id+内容指纹**而非位置，保证跨轮稳定（要求作者复用 block id）。
- **容错以"文件即状态 + ack 幂等锁 + 启动对账"**实现，无需数据库/队列中间件——契合零依赖与复用 control-plane 文件态理念。
- **driver 可插拔**：claude-exec 为默认 CLI 驱动；listener 只认文件契约，未来换 SDK/飞书载体不改内核。

---

## 13. UX 自审修订（已采纳，覆盖前文相应小节）

独立 UX 评审后采纳以下修订，**优先级高于前文冲突处**，子代理须按此实现。完整原始评审见 docs/feedback-log.md。

> **落地校验（批次 6，2026-07-03）**：本节部分"已采纳"项此前只落文档、代码断了，已在批次 6 补齐并加测试断言（详见 docs/dev-log.md「批次 6」）：
> - ✅ **P0-1** 提交前确认改真·模态（`<dialog>`），未表态/重要默认项可就地展开并跳转补填（此前仅 `confirm()` 列 id）。
> - ✅ **P0-3** zoneC-Fyi 折叠标题前缀重复 bug 修复（分区过滤本身正确）。
> - ✅ **P1** 议题重组提示：前端消费服务端 `sanity.suspect` → 顶部横幅（此前算了不展示）。
> - ✅ **P1** 「↩已采纳/—维持」徽章补 CSS（此前退化成橙色/无样式）。
> - ✅ **P2** 长页面进度「已填 m/X」实时更新（此前 `<progress value>` 恒 0）。
> - 仍未落地（后续批次）：字段级 diff 前端并排对照、可访问性 aria 关联、暗色对比度全面复核。

### P0-1 杜绝"盲签"：统一提交前确认（改 §6.4 + §2.4）
- 提交时弹**摘要确认层**：「你将 — 决策 a 项 / 接受 b 项默认（含 c 项重要）/ d 项未表态」，重要默认与未表态项可就地展开复核。
- feedback.json 增 `unanswered:[blockId]`（needsDecision 但用户未操作的块）；前端用 `attention.unansweredDecisions()` 计算。edit 与 comment 是同一 blockId 下的两条独立 item。
- 区 A（needsDecision 且无推荐）若有未填项，提交按钮二次确认并锚点跳转。

### P0-2 区分"处理中"与"离线"，修心跳误报（改 §6.1 + §6.3）
- 心跳必须**独立异步定时**写，不被 claude-exec 子进程阻塞。
- status.json 增 `claimedAt`、`supervisorState:"alive"|"dead"`；error 改为 `{kind,message,userMessage,suggestedAction,at}`。
- 前端/服务端统一用 `protocol/status.mjs` 的 `displayState(status, now)` 联合判定：`claimed+心跳新鲜=processing`（再久也不误判）；`非claimed+心跳过期=offline`；`supervisorState==='dead'=dead(终态)`。

### P0-3 区 C 不再一刀切折叠（改 §4）
- zoneC 拆两级：`importance==='high'` 的已设默认 → **zoneCReview「默认采用·建议过目」**（半展开、逐条带 default 值预览）；normal/low → **zoneCFyi** 折叠，标题给默认值摘要而非只报数量。

### P1（采纳）
- **异步价值兑现**（§6.4/§9）：processing 显示已等待时长（用 claimedAt）+ `document.title` 角标 +（授权后）Notification；首次提交弹一次性 toast 说明"可离开"。
- **错误说人话**（§6.1/§6.4）：按 `error.kind` 显示 userMessage/suggestedAction；driver 配置类错误**不给**「重试」（避免误导），原始 message 收进折叠详情。
- **自愈终态**（§6.3/§6.4）：监管重启耗尽 → `supervisorState:"dead"` → 前端「⛔ 服务未恢复，提交已安全保存在 round-n/feedback.json，请联系维护者」，消灭"永远🔴"假承诺。
- **diff 更真**（§5/§10）：computeDiff 额外产出 `removed`（上轮有本轮无）+ changed 块带 `_changedFields` 与 `_prev`（字段级对照）；模板用**语义 slug 生成稳定 block id**；本轮 >60% 块同时 new 且上轮等量 removed → 顶部提示「可能议题重组，diff 仅供参考」。
- **verdict 异议/疑问** 强引导填理由（§2.3，空不阻断但软提醒）。
- **已 claimed 的轮**：POST /api/feedback 返回 409（提示"处理中，请等待或撤回重填"）；区分「重试」(原反馈再跑) 与「撤回重填」(清 ack 允许改后重提)（§8/§6.4）。
- **🟡处理中态不给普通「重试」**，仅「强制重试」(二次确认，警示可能重复)（§6.4）。

### P2（采纳）
- 可访问性：色彩非唯一信号，区/变更徽章叠加形状图标 + 文字（◆需答/◇建议/＋新增/～改动）；暗色对比度复核（§9）。
- 长页面：状态条「需你决策」做成进度「已填 m/X」+ 区/块跳转锚点（§4）。
- 退化态文案：全默认→主按钮变「确认」、状态条「无需你决策，确认即可」；无 zoneC→不渲染折叠容器；全 unchanged→只看变更空列表提示；首次使用引导（§4/§9 新增"空态与退化态"）。

---

## 14. embed 产物嵌入 + 就地批注（dogfood 增补）

**动机**：当 AI 的产物是一个真实网页/可视化（如部署好的 HTML 页），用户需要**在产物本身上就地圈点批注**，而不是只在抽象 block 上表态。

- **block 类型 `embed`**：`{id, type:'embed', title, url, height?}`。渲染为 iframe + 批注 overlay。
- **代理 `/api/proxy?url=`**：很多站点带 `X-Frame-Options/CSP` 禁止被 iframe。服务端反代目标页：抓取 HTML → **不转发** `x-frame-options`/`content-security-policy` → 注入 `<base href="<url>">`（原站相对资源正常加载）→ 同源返回。iframe 指向 `/api/proxy?url=<encoded>`。纯函数 `rewriteEmbedHtml(html, url)` 可单测；仅 http/https、10s 超时、失败降级错误页。
- **飞书式批注（选中文字→评论→右栏）**：因页面经 `/api/proxy` **同源**嵌入，监听 iframe 内选区——用户**选中文字**即浮出「💬 评论」按钮（无"批注模式"开关）；点击在**右侧评论栏**建卡片（引用原文 + 评论），每条可 **保存 / 编辑 / 删除**；也可「+ 新增批注」写不锚定文字的整体意见。best-effort 用 CSS Custom Highlight API 高亮原文。
- **布局**：embed 区左右两栏——左=内容（iframe），右=固定宽度评论栏。
- **数据/反馈**：草稿 `comments:[{id,quote,text,done}]`；**创建不落草稿、保存空内容即丢弃**（不产生空评论）；提交为 `{blockId, type:'pin', value:{quote}, comment}`（quote=引用原文，整体意见为 null）。
- **局限**：文字锚定按 quote 文本 best-effort 定位/高亮（重复文本可能不精确）；目标页若强依赖自身同源后端，代理下动态请求可能失效（静态展示页无碍）。

---

## 15. tab 分面导航（批次 7，2026-07-04）

restore prd-studio 六面 tab 体验，工作台原生化——**用角标 + 全局提交确认消除隐藏式 tab 的盲签风险**。

- **协议**：块可选 `section: string`（需求/架构/UI 设计/交互设计/测试/风险…）；content 可选 `sections: string[]` 覆盖类目顺序。无需改 schema（validateBlock 宽容额外字段）；`section` 不进 blockFingerprint（换面不触发 diff）。
- **启用**：存在 `section` 或 `content.sections` → tab 模式；否则纯注意力分区（向后兼容，老 session 渲染不变）。
- **canonical 类目**（`constants.DEFAULT_SECTIONS`）：需求 / 架构 / UI 设计 / 交互设计 / 测试 / 风险。全部常显，空面渲染为**灰 tab**（disabled）；无 section 块归「其他」（仅非空时出现）；自定义面追加在 canonical 之后。
- **tab 角标（防漏看）**：每面 = 未确认决策数；红=含必须确认(`needsDecision && !hasRecommendation`)、橙=只剩可接受(有推荐)、绿=已清零。用户每确认一个即递减（`app.mjs updateFacetBadges`）。
- **面内顺序**：设计方案(zoneContext) → 必须确认(zoneA) → 可接受(zoneB) → 已设默认(zoneC) → 沉降(zoneSettled)，复用 `renderZoneBody`（各面 zone id 加 `-f<i>` 后缀避免重复）。
- **默认激活面**：第一个"含未确认必须决策"的非空面；否则第一个非空面。
- **防盲签四重网**：① 角标常显未确认数（切走也知哪面欠）；② 全局进度「已填 m/X」跨所有面；③ 提交确认弹层列跨所有面未表态项，点击**自动切到所在 tab** 再高亮（jumpToBlock 跨面激活）；④ 提交时"必须决策"未确定 >0 → 弹层顶部红字「⚠️ 还有 X 个必须决策的点没确定」，主按钮变「仍要提交」。
- **模板产出 section**：`dev-review`（需求/架构/测试）、`design-review`（`screen.section`，默认「UI 设计」，可覆盖「交互设计」；checklist→测试）。

---

## 16. 内容可理解性协议（批次 8，2026-07-13 实战反馈落地）

来源：`docs/iteration-brief-2026-07-13.md` + `docs/feedback-examples-2026-07-13.md`（Michael 实战 4 轮）。
根因：**没有背景的决策块不是"没人答"，而是产出零质量的伪决策**——用户照样点推荐项，作者不敢采信，白费一轮。

### 16.1 决策块结构化（创始人加权·最高 UX 优先级）
协议与渲染层仍把字段定义为**可选**，缺失字段不渲染，以保证历史 workspace 向后兼容；但新内容走 `present` 时必须满足 §16.2 的完整性硬校验：

| 字段 | 含义 |
|---|---|
| `background` | 背景：这东西是谁做的、现在什么状态、为什么突然要处置它（一句话本质类比优先） |
| `why` | 为什么需要你定、为什么是现在（含四维自评：有无标准答案 / 置信度 / 重要性 / **可回退性**） |
| `options[].pros` / `.cons` | 选项**利弊**：讲后果，不讲机制（替代把一切塞进 `desc`） |
| `recommendReason` | 推荐理由 |

渲染次序：**背景 → 为什么需要你定 → 选项（各带利弊）→ 推荐及理由**。
四字段均进 `blockFingerprint` → AI 补了背景，该轮标 CHANGED。

### 16.2 作者侧 lint（`src/protocol/lint.mjs`）
`present`/`render` 都会把普通 lint warning 打到 stderr。7 条规则全部对应真实病例：
`missing-background` · `missing-why` · `missing-proscons` · `missing-recommend-reason` · `editable-for-confirm` · `multi-question` · `unexplained-jargon`。

`present` 对其中的决策完整性要求执行硬阻断：所有 `needsDecision:true` 块必须有非空 `background`/`why`；choice 的每个 option 必须同时有非空 `pros`/`cons`；`hasRecommendation:true` 时必须有非空 `recommendReason`。失败时按块列出 id 与缺失字段，拒绝写入新轮次并以非 0 退出。`--allow-incomplete-decisions` 可显式临时绕过，仍保留 warning，并在 stdout JSON 标记 `lintBypassed:true`。

硬校验只挂在新内容的 `present` 调用链：`render` 默认仍只 warning，`serve` 与已有 workspace 轮次不回溯校验，`needsDecision:false` 完全不受影响。
规范见 `docs/authoring-guide.md`。

### 16.3 受众分层
块可选 `audience: "decider" | "tech"`。`tech` → 整块折叠进「🔧 技术细节（决策者可跳过）」。
依据：`needsDecision:false` **不等于"不占注意力"**（病例 2）。

### 16.4 live 实时系统标识
`embed` / `prototype(iframe)` 可选 `live: true` → 红框 + 「⚡ 实时系统 · 就地操作会真实生效」角标。
依据：**文案救不了 affordance**——标题写了"真实产物"用户仍当样例（病例 7）。实时性感知必须靠视觉层。

### 16.5 会话级留言
渲染页常驻「💬 给 AI 留言」输入区 → `feedback.sessionComment`（string，可空）。
依据：用户被迫把给工作台的全局反馈挂在不相干块的批注里（病例 6）。

### 16.6 确认场景低摩擦
`editable` 提供「✓ 保持原样即确认」一键 → feedback `type: 'confirm'`（**看了不改**），与 `unanswered`（**没看**）语义区分。
依据：行为数据——预填 editable 连续两轮无人应答，改 verdict 后当轮通过（病例 5）。

### 16.7 embed 代理支持非 GET（P0 bug 修复）
`/api/proxy` 支持 GET/POST/PUT/DELETE：透传 method / body / Content-Type，回传真实状态码与 content-type；
`rewriteEmbedHtml` 把**表单 action 与 fetch/XHR 改写回代理通道**（此前 `<base href>` 让它们直接打回原站 → 字段/凭证丢失，实证 bug）。

### 16.8 富渲染最后一公里
- `scripts/import-prd-project.mjs` 补 `convertUI`：prd-studio 的 `ui.screens[]` → `prototype(mode:'iframe', src, frame:'phone')`（此前整个 convertUI 缺失，10 个高保真屏进不来）。
- `prototype` 新增可选 `frame: 'phone'` → 360×740 手机壳呈现（`box-sizing: content-box`，内宽正好 360）。
- import 自动打 `section` → 六面 tab（需求/架构/UI 设计/交互设计/测试/风险）。
- 渲染页支持 `?facet=<面名|序号>` 深链，可分享某一面。

### 16.9 线框原型：手机壳 + 「编辑」模式（复刻 prd-studio）

融合时曾把 prd-studio 的 wireframe 拖拽编辑判为"可弃用"，实测用户需要它。本次补回：

- **手机壳**：`prototype` 的 `frame: 'phone'` 现在 **wireframe 与 iframe 都支持** → 360×740 + 10px 黑边 + **刘海 `.proto-notch`**（对齐 prd-studio 的 `.phone`/`.notch`）。import 的 `convertProto` 自动打 `frame:'phone'`。
- **模式工具条**（仅 wireframe）：`🖊 批注` / `✥ 编辑（移动控件）` / `↺ 复位`。
  - 批注模式：SVG overlay 捕获点击落 pin（原行为）。
  - 编辑模式：overlay 让位（`pointer-events:none`），控件显示虚线轮廓 + 右下角缩放柄，可**拖动移位 / 拖角缩放**。
- **零依赖实现**：不引 interact.js，用原生 pointer events（`pointerdown/move/up` + `setPointerCapture`，带 try/catch 防无效 pointerId）；`touch-action:none` 保证移动端可拖。
- **反馈协议**：`FEEDBACK_TYPES` 新增 `move` → `{blockId, type:'move', value:{widgetId, x, y, w, h}}`，坐标**归一化 0-1**（与 block 的 widget 坐标同制）。草稿存 `draft[blockId].moves`，跨刷新可还原，可一键复位。
- 真机 dogfood（chrome-devtools）：点编辑 → 画布 `data-mode=edit`；拖动 title 控件 → `top 4.44% → 20.23%`、草稿写入 `moves:{title:{x,y,w,h}}`；复位还原。

### 16.10 会话资产自托管（去掉外部服务依赖）

问题：高保真 UI 稿原住在 prd-studio 仓库，Vibe 通过 `http://127.0.0.1:8088` 代理去取 —— **prd-studio 的服务不开，UI 面就空了**。

- **新路由** `GET /assets/<session>/<path>` → `workspace/<session>/assets/<path>`。
  - session 名白名单 `^[A-Za-z0-9._-]+$`；子路径 `path.resolve` 后必须仍在 `assets/` 内（防穿越）；`Cache-Control: no-store`。
  - 语义：**资产属于 session 内容**（runtime 数据，gitignore），不污染工具仓库。
- **import 默认自托管**：`convertUI` 把 `public/ui/*.html` **拷进** `workspace/<session>/assets/ui/`，块的 `src` 写成 `/assets/<session>/ui/<file>`。传 `--ui-base http://…` 才改为引用外部 URL。
- **renderPrototype(iframe)**：`src` 为**同源相对路径 → 直连**（不绕 `/api/proxy`，更快，且 iframe 同源便于后续文字锚定批注）；外站**绝对 URL 仍走代理**（绕过 X-Frame-Options）。
- 实证：关闭 prd-studio（:8088 → 000）后，UI 面 10 个高保真屏仍正常渲染（iframe src = `/assets/prd-recorder/ui/b-home.html`，200）。
