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
  "title": "可选标题",
  "body": "...",                 // markdown / mermaid 源 / 提示文案（按 type 释义）

  // —— 注意力元数据（FR-7，渲染器据此分区排序）——
  "needsDecision": false,        // 是否需要用户做决策/操作
  "hasRecommendation": false,    // 是否带推荐答案/默认
  "recommendation": null,        // 推荐值（optionId / 文本 / verdict）
  "importance": "normal",        // high | normal | low
  "default": null,               // 预填默认（无需决策项的既定值，用户同意即跳过）

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
- markdown：内置极简 md→HTML（标题/列表/粗体/代码/换行/链接），避免外部依赖。
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
  session.json                 { claudeSessionId, cwd, createdAt }  ← --resume 续接
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

---

## 8. Server API（`server/server.mjs`，零依赖）

| 方法 路径 | 作用 |
|---|---|
| GET `/` 及静态 | 托管 src/render/ |
| GET `/api/content?session=&round=` | 返回该轮 content.json（含 diff `_change`，服务端注入） |
| POST `/api/feedback` | 写 feedback.json/.md，status=submitted；断连前端降级导出 |
| GET `/api/status?session=` | 返回 status.json + 心跳新鲜度 |
| POST `/api/retry?session=&round=` | 重置该轮为 submitted（清 ack/error） |
| GET `/api/sessions` | 列出 workspace 下会话（dev 用） |
| GET `/api/health` | `{ok,ts}` |

服务端在返回 content 时调用 `diff.computeDiff` 注入 `_change`、`attention.routeBlocks` 可前端做（前端做，便于"只看变更"交互）。

---

## 9. 视觉与交互设计语言

- 克制、信息优先：浅色为主 + 暗色切换（复用 prd-studio CSS 变量）。强调色仅用于注意力分区（红=需定无预设、橙=需定有推荐/CHANGED、绿=NEW、蓝=已回复）。
- 顶部固定状态条：左=会话/轮次 + diff 开关「只看变更」；右=AI 状态徽章 + 「提交」。
- 分区视觉：区 A/B 卡片带左色条 + 徽章；区 C 折叠。
- 移动友好：单列、viewport-fit、控件触摸尺寸（为 phase 2 飞书/移动载体铺路）。
- 草稿即时存 localStorage，防丢。

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
