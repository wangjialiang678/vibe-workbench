# 架构评审 · Opus（独立评审，2026-08-30）

> 我没有读同目录下的 `codex.md` 与 `fable-主会话预判.md`，以保持独立性。
> 结论基于 `00-briefing.md` 的数据 + 我自己读的代码，关键判断均附文件路径与行号。
> 未读 `workspace/`（客户数据）。

**核心主张：这个系统不需要重写，需要「砍掉四分之一、把边界钉死在一处」。**
真正被使用的产品（present→feedback 循环 + block 协议 + 注意力路由 + 轮次 diff）代码质量是全仓最高的，
不到 40% 体量；从未承载过一个任务的「执行面/派工/控制塔」占约 24%，且把 owner token 变成了两台机器上的远程代码执行。
唯一的真架构缺陷是**没有存储层**和**server↔routes 是假拆分（ESM 循环依赖）**——这两个都是「补一层 + 真拆一次」，不是绿地重写。

---

## 一、逐子系统判决表

| 子系统（行数） | 判决 | 理由（证据） |
|---|---|---|
| `protocol/`（attention 152 + diff 46 + schema 119 + lint 121 + status + constants + block-types，≈700） | **原样复用，升格为版本化契约** | 纯函数、零 I/O、零 DOM、前后端共享。`diff.mjs` 仅 46 行却支撑 16 个多轮会话的核心机制。全仓最健康的代码。 |
| `render/` 纯渲染模块（blocks 410 / attention-view 208 / md 197 / stream-view 349 / diff-view / status-bar / submit-payload / submit-state / draft-store / round-nav / pin-geometry / facet-state，≈1500） | **原样复用** | string in / string out，可脱离浏览器单测（`attention-view.mjs:182` renderZones 是纯函数）。不引框架已经可测，引框架反而失去这个性质。 |
| `theme.css`(118) + `index.html`(152) | **原样复用·锁死** | 视觉成果已被 `tests/unit/css-vars.test.mjs` 守卫（字体栈/行高/固定亮色/令牌完整性）。创始人价值观的直接固化物。 |
| `render/app.mjs`(2382) | **改造复用（抽薄，不重写）** | 纯逻辑早已抽走，剩下约 100 个函数中 `bindInteractions`(1692–1925) 一个就 234 行逐元素绑定，事件委托可压到 1/5。零行为覆盖，只能靠源码正则"锁住"——那是症状不是病因。重写风险 > 收益。 |
| `server/server.mjs`(1215) + `routes/*`(≈1200) | **改造复用：真拆一次** | 现拆分是假的：`server.mjs` 末尾 `export {}` 导出 **94 个符号，含 `fs` 与 `path` 本体**；13 个 route 里 11 个从 `../server.mjs` 反向 import（`routes/pages.mjs:1-7` 拿 `fs`）→ **ESM 循环依赖**；每个 handler 首行解构 19 字段 god-ctx（`routes/health.mjs:2` 为此写了一行 300 字符）；`feedbackHistorySeq` 在 `server.mjs:634` 与 `routes/feedback.mjs:23` 各一份，前者已死。逻辑本身是线上事故淬炼过的，别扔。 |
| `workspace.mjs`(186) | **改造复用 → 升格为唯一存储层** | 形状已经对（paths 表 + `writeRound` 原子 mkdir 防覆盖），但没人被迫走它：全仓 **105 处 `fs.*` 散在 13 个文件**；`bin/workbench.mjs:69` 走 `writeRound(默认 allowOverwrite:true)`，`routes/session.mjs:87` 走 `allowOverwrite:false`——**同一个「present 一轮」，本地 CLI 能覆盖、HTTP 不能**。这就是坑 #2 没被修掉的证据。 |
| `executor-inbox`(532) + `routes/inbox`(131) + `scripts/local-listener`(866) + 测试(1233) ≈ **2760** | **砍掉** | 0 任务、0 生产使用。local-listener 唯一职责就是轮询这个空队列。且见风险 #1：它是 RCE 通道。 |
| `control-tower`(664) + `control/`(326) + 路由 + 测试 ≈ **1500** | **砍掉**（如需保留，降级为 50 行只读会话概览） | 无持久化数据；它展示的主要内容来自刚被砍掉的 inbox；是 server 侧引入 `execFileSync` 的唯一原因（`control-tower.mjs:4`）。 |
| `scripts/resident-worker.mjs`(1508) + 测试(1614) ≈ **3120** | **移出本仓库** | 第二套 AI 执行引擎：自己的 HTTP 服务(:8097)、状态文件、心跳、git worktree 快照、`codex exec --sandbox danger-full-access`。与 `loop/agent-exec.mjs` 职责重叠且有逐字重复代码。它不是「工作台」，不该住在工作台仓库。 |
| `projects.mjs`(469) + projects-view + 路由 + 迁移脚本 + 测试 ≈ 1760 | **砍到只剩会话索引（≈80 行）** | 注册表无数据，但 `/api/projects` 是参与者 `?token=X`（无 session）时的落地页数据源（`app.mjs:240,2251`），不能整个砍。要砍的是 `EXECUTORS` / `CONTROL_TOWER_LEVELS` / execution-context 这套投机建模（`projects.mjs:20-28`）。**顺手必须修 P0，见风险 #2。** |
| `documents.mjs`(224) + documents-view + 路由 + 测试 ≈ 950 | **砍掉子系统，保留能力** | 1 个会话用过。它做的事＝往 `workspace/<s>/documents/<分类>/<slug>.md` 写带 frontmatter 的 md。保留 `workbench doc-publish` 直写文件 + 前端读目录即可。 |
| `stream.mjs`(333) + stream-view + 路由 + 测试 ≈ 2370 | **改造复用：正名为 journal + 附件通道** | 人类消息只有 19 条，但同一 JSONL 还承载 `receipt`（每次提交自动写）与**附件上传**——xlsx/docx MIME 是 2026-08-20 思锐门户实测加的（`server.mjs:115-122`），删了客户就传不了文件。append-only JSONL 正是 Q8 要的 journal 底座。要砍的是 `ask/answer` 双向问答：它是 server 里最难的权限代码（`filterStreamEntriesForIdentity`、`assertParticipantCanAnswerAsk`，≈60 行）。**不确定它是否被真实使用过，简报无此项数据**——请先数 workspace 里 `kind:"ask"` 的条数再决定。 |
| `loop/`(listener 254 + agent-exec 609 + session-store + claude-exec) | **改造复用** | 形状对：ack 幂等锁 + reconcile 对账 + 错误分类落 error.json，且是唯一在跑的执行回路。缺陷：`reconcile` 每 2s 全量扫所有 session 所有轮做 3 次 `exists()`；心跳每 10s 给全部 37 个 session 各写一次 status.json（`listener.mjs:221-232`）——把 mtime 搅浑，"谁动了什么"不可查。 |
| `src/render/_lab/`（1.9 MB，6 个 143KB HTML） | **立即删除（P0）** | 全仓零引用。gitignore 挡住了入库，**没挡住 HTTP**：它住在 `src/render/` 下，`pages.mjs:29` 把整个 `src/` 当静态根，`.html` 只需任意参与者 token 即可取——内容是真实会话 DOM 快照（客户数据）；`.css` 连 token 都不要（在 `PUBLIC_STATIC_EXTENSIONS` 白名单里）。 |
| `docs/DESIGN.md`(502) | **重写** | §13–§16 明写"覆盖前文相应小节"，必须顺序通读才知道哪段作废。文档债与代码债同构，冷启动测试过不了。 |
| `bin/workbench.mjs`(755) | **改造复用** | AI 侧真实契约只有 `present` / `wait` 两条，很小很对。问题是它有一套与服务端平行的本地写路径（见 workspace 行）。 |
| CI（`.github/workflows/ci.yml`） | **原样复用** | 3 OS × Node 22 跑全量测试，已经在拦"本地能跑服务器崩"这类问题。 |

---

## 二、目标架构

五层，依赖严格单向向下，**render 只依赖 protocol**：

```
protocol/    纯：类型、校验、指纹、diff、注意力路由、lint。零 I/O 零 DOM。前后端共享。
   ↑
storage/     唯一 fs 出口。对外只暴露业务动作（createRound/appendFeedback/appendJournal），
             不暴露 read/write 原语——不变量写在这里，绕不过去。
   ↑
core/        用例层：presentRound / submitFeedback / roundView / resolveIdentity / visibleFor。
             纯 JS，依赖注入，不认识 req/res，不 import node:http。
   ↑
adapters/    server（http↔core）、cli（argv↔core）、loop（定时器↔core）。三个入口共用同一批用例。
render/      浏览器端，只 import protocol；由 adapters/server 静态托管。
```

**依赖方向靠测试强制，不靠自觉**（三条都是结构性的——违规代码写不出来，而不是"违规了希望有人发现"）：

1. `tests/guards/layering.test.mjs`：解析每个源文件的 import，断言「不得向上 import」「不得成环」。**这条今天就会红**，因为 `routes/* ↔ server.mjs` 是环。
2. `node:fs` 白名单测试：只允许出现在 `storage/` 与 `adapters/cli` 入口——把今天的 105 处收敛成一个可数集合。
3. handler 签名禁令：route 只接显式参数，不接 ctx 对象。

**一轮 present → feedback 的数据流：**

1. AI 执行 `workbench present <s> content.json` → cli adapter → `core.presentRound(s, content)`。
2. core：`protocol.validateContent` + `lintContent` → `storage.createRound()`（原子 mkdir 占位，**唯一**允许写 round 的入口，永不覆盖；本地与远程走同一条，不再有两套不变量）→ 返回 `{round, url}`。
3. 浏览器 `GET /render/` → server adapter 托管 index.html（注入 `assetsVersion` 与 importmap，缓存击穿机制原样保留）。
4. `GET /api/content` → `core.roundView(s, r, identity)` → `storage.readRound(r)` + `readRound(r-1)` → `protocol.computeDiff` → `core.visibleFor(identity)` 过滤 → JSON。
5. `render/app.mjs` → `protocol.routeBlocks` 分区 → `blocks.blockHtml` 出 HTML → 挂 DOM；草稿写 localStorage。
6. `POST /api/feedback` → server adapter 只做解析与鉴权 → `core.submitFeedback(s, r, identity, payload)` → `storage.appendFeedback()`（历史件 → 主件 → status 三步的顺序与原子性写在这一个函数里，不再散在 HTTP handler）+ `storage.appendJournal(receipt)`。
7. loop adapter 轮询 `storage.pendingRounds()` → `agent-exec` → `storage.writeResponse()`；AI 端 `workbench wait` 返回，续跑下一轮。

---

## 三、迁移分期（绞杀式，全程不停机——门户在跑）

### 第 0 期 · 止血（当天，约 30 分钟）
范围：删 `src/render/_lab/`；`/api/sessions` 与 `/api/projects` 加 identity 过滤；`/api/health` 返回版本。
**验收：** ① 新增 3 条测试并全绿：参与者 token 请求 `/api/projects` 只见到自己有可见块的会话、`GET /render/_lab/0-current.html` 返回 404、health 响应含 `version`/`commit`；② 全量 `pass ≥ 621 / fail 0`。

### 第 1 期 · 安全网先行（动刀之前）
范围：把 2026-08-22 那次手工对拍固化为 `scripts/ab-compare.mjs`——起两个 server（基线 commit / 工作副本）指向**同一份只读 workspace 夹具**，跑请求清单逐行 diff（归一化 ts/assetsVersion）。清单 ≥ 60 条，覆盖 owner / participant / 无 token × 全部端点，**并显式包含 12 条"近似路径"**（`/api/participants-public`、`/api/inbox`、`/api/participant`、`/assets`、`/render/x`）。同期建 `tests/fixtures/golden/`：10 份代表性 content.json（覆盖 choice/verdict/markdown/prototype/diagram = 81% 真实用量）→ 对 `computeDiff`、`routeBlocks`、`renderZones` 输出落 golden。
**验收：** ① `node scripts/ab-compare.mjs --base HEAD` 零差异；② golden 契约测试 ≥ 30 条；③ **反向验证安全网本身**：故意把 `routes/index.mjs` 的 prefixRoutes 顺序调换 → ab-compare 必须报错；故意改一个 block 渲染 → golden 必须报错；④ 每条请求设 2s 硬超时，超时计入差异（上次那个 bug 的特征是永久挂起，只 diff body 抓不到）。

### 第 2 期 · 一次性删除执行面
范围：删 executor-inbox / routes/inbox / local-listener / control-tower / control/ / routes/control-tower / 对应测试 / `docs/executor-inbox-protocol.md` / `docs/local-listener.md`；resident-worker 移出仓库；projects 砍到会话索引。按「先断引用 → 跑 ab-compare → 再删文件」两步走，每步单独可回滚。
**验收：** ① `wc -l` 净减 ≥ 7000 行；② 剩余测试 fail 0；③ ab-compare 对**保留端点**零差异，被删端点在清单里标 `expected-404` 并断言确实 404；④ 门户真人冒烟一次：present 一轮 → 手机打开 → 提交 → `feedback.json` 落盘 → AI `wait` 返回。

### 第 3 期 · 存储层收口
范围：新建 `storage/`，把 105 处 fs 收敛；消灭 present 的双写路径（bin 与 server 都走 `core.presentRound`）；feedback 落盘搬进 `storage.appendFeedback`。
**验收：** ① fs 白名单测试通过（`node:fs` 仅出现在 storage/ 与 bin 入口）；② 新增不变量测试：同一轮二次 present 必抛 `ROUND_EXISTS`——**CLI 与 HTTP 两条路各测一次**（这是今天真实存在的 bug）；③ 并发 20 个 feedback POST 后历史件恰好 20 份、主件为最后一笔、零丢失；④ 写盘失败时返回 5xx 且错误信息含真实原因（今天会被翻译成 `invalid JSON`，见风险 #5）；⑤ ab-compare 零差异。

### 第 4 期 · 服务端真拆 + 前端抽薄
范围：`core/` 用例层落地，routes 只做 http↔core 转换；分层测试上线；`bindInteractions` 改事件委托。
**验收：** ① `layering.test.mjs` 通过（含无环断言）；② `server.mjs` 的 `export {}` 符号数 ≤ 5（今天 94），且无任何 route 文件 import `../server.mjs`；③ `app.mjs` ≤ 900 行，且 `render.test.mjs` 里源码正则断言 ≤ 20（今天约 65）；④ ab-compare 零差异 + 冒烟一次。

### 第 5 期 · 部署收口
范围：见 Q6。**验收：** `scripts/check-deploys.mjs` 打印三台机器的 commit 表且全部一致，不一致则非零退出；接进收工检查清单。

---

## 四、Top 5 风险及缓解

1. **执行面把 owner token 变成两台机器的 RCE。** `POST /api/inbox/tasks` 只要 owner token（`routes/inbox.mjs:17-20`），任务里的 `prompt` 会被 `local-listener` 用 `claude -p --dangerously-skip-permissions` 在创始人 Mac 上执行（`local-listener.mjs:423-427`），或被 resident-worker 用 `codex exec --sandbox danger-full-access` 在东京机执行。而 owner token 是**放在 URL query 里**传递的（页面链接、`?token=`），会进访问日志与浏览器历史。**缓解：第 2 期整体删除；在删除前，先把 `/api/inbox/` 路由摘掉（一行）。** 这条比"0 使用"更能决定判决。
2. **跨客户信息泄漏已经发生。** `/api/sessions` 与 `/api/projects` 完全不做 identity 过滤（`routes/projects.mjs:11-14, 21-29`），任何参与者 token 都能拿到全部 37 个会话 id 与所有项目/会话标题；前端 `loadSessions()` 直接把它渲染成下拉框——思锐的客户能在下拉框里看到其他客户的会话名。块级可见性做得很细（blocks/assets/feedback/stream 四处过滤），**唯独会话索引漏网，且无任何测试覆盖**。这正是坑 #9「权限模型有机生长」的活证据，说明大概率还有第二个漏网。**缓解：第 0 期修；第 1 期把「参与者能看到的一切」做成枚举表 golden 测试——对每个 GET 端点用 participant token 各请求一次并快照，新端点不进表就红。**
3. **对拍 harness 只比 body、抓不到"挂起"类故障。** 618 条测试全绿仍漏掉的那个 bug，特征是连接永不结束而非返回错值。**缓解：harness 对每条请求设 2s 硬超时并把超时计为差异；清单里显式加"近似路径"邻居组；并在第 1 期用故意注入的错误反向验证 harness 自己有效。**
4. **删除执行面时误伤在用路径。** `startServer` 里会实例化 `createControlTowerService`，`server/notify.mjs` 也 import 了 executor-inbox——依赖是活的。**缓解：两步删除（先断引用跑对拍，再删文件），每步独立提交可回滚；`/api/projects` 因为是门户落地页数据源，必须降级而不是删除。**
5. **异常被统一翻译成同一句谎话。** `routes/feedback.mjs` 把整个 handler 包在 `readBody().then(...)` 里，`.catch()` 一律回 `invalid JSON`（:173-175）。磁盘写失败、`appendStreamEntry` 抛错，客户看到的都是"invalid JSON"，而反馈可能**已经落盘一半**（历史件已写、主件未写），客户重试则产生重复。这比没有日志更伤。**缓解：第 3 期把 core 用例的错误分类（校验失败/冲突/存储失败）映射成不同状态码与日志，并补一条"写盘失败必须 5xx 且信息含真实原因"的测试。**

---

## 五、逐条回答 Q1–Q8

**Q1 · 零依赖 + 无构建前端要不要保留？**
保留，并写进架构文件当硬约束。618 条测试 7.5 秒跑完、零 `npm install`、浏览器直连 ESM——本项目最大的失败模式是「功能一多就长回去」，零依赖是唯一一条**不需要人自觉执行**的复杂度上限。SQLite 不值得（见 Q2）；esbuild 不值得：app.mjs 抽薄后前端总量 < 6000 行，且打包会引入第二种「用户拿到的是哪份」漂移，而这正是坑 #5。建议再加一条测试断言 `package.json` 的 `dependencies` 为空。

**Q2 · 存储：文件 vs DB？**
继续「文件系统即事实源」，语义一个字不改。2026-08-19 覆盖事故的**恢复**靠的就是直接读文件；workspace 的人可读性是产品的一部分。真正的问题不是介质而是**没有存储层**：105 处 fs、同一操作两套不变量（`bin/workbench.mjs:69` vs `routes/session.mjs:87`）。加一层 `storage/` 即可，一行 SQL 都不用。若将来需要全局检索/审计，加一个**从文件重建的只读索引**（可随时删掉重建），绝不让 DB 成为事实源。

**Q3 · 目标分层与强制手段？**
`protocol → storage → core → adapters(server/cli/loop)`，`render` 只依赖 `protocol`。强制靠三条结构性测试：① 依赖方向 + 无环（今天就会红，因为 routes↔server.mjs 成环）；② `node:fs` 白名单；③ handler 禁 god-ctx。关键在于这三条让违规**写不出来**，而不是靠 review 发现——这正是坑 #1「架构没有强制边界」的对症药。

**Q4 · 砍什么？砍错的代价？**
砍：executor-inbox + local-listener + control-tower + resident-worker（含测试约 7300 行，占全仓 25%）；documents 降级为一个 md 目录；projects 砍到会话索引；`_lab/` 立即删。保留 stream 的 JSONL 作为 journal 底座与附件通道，砍其 ask/answer（**此项不确定，先数 `kind:"ask"` 条数**）。**砍错的代价不对称**：inbox/tower 是纯增量功能，真需要时按当时真实需求重写 150–300 行即可，比维护 7000 行投机代码便宜一个数量级；反过来，砍错 stream 的代价是实的——xlsx/docx 附件是客户实测加的，删了客户传不了文件。

**Q5 · 迁移策略？**
绞杀式，不绿地。理由：门户在跑，且**真正需要重写的模块是零个**——最差的 app.mjs 也是"抽薄"而非"重写"。顺序刻意反直觉：**先建安全网（第 1 期）再动刀**，因为 618 条测试已被证明拦不住重构回归。对拍全程在场：每期验收里都有「ab-compare 零差异」，删除端点则在清单里显式标 `expected-404`——让"故意的变化"也必须被写下来，这样"没写下来的变化"就一定是 bug。

**Q6 · 三份部署的版本漂移？**
根因是**没有任何办法问一台机器"你跑的是哪份代码"**：`/api/health` 只返回 `{ok:true, ts}`（`routes/health.mjs:4`），且它在 token 门之后，匿名探活拿不到。三步根治：① health 返回 `{version, commit, assetsVersion, startedAt, workspaceDir}`，commit 在部署时写进 `version.json`、运行时读取（不在服务端调 git）；② 部署改 `git fetch && git checkout <sha> && systemctl restart`，**禁止 rsync**——rsync 无法回答"这是哪个提交"；③ 加 `scripts/check-deploys.mjs` 并发探三台、打成一张 commit 表，不一致即非零退出。另外 `bin/workbench.mjs` 的 `ensureServer` 用 health 存活就复用现成 server（:281-283），加上 version 后应改为「版本不符则拒绝复用并提示重启」——这一条直接消灭坑 #5 的"server 常驻不热载"。

**Q7 · 测试架构？如何让假测试写不出来？**
四层各司其职：① **契约层**：10 份 golden content.json → `computeDiff`/`routeBlocks`/`renderZones` 输出落 golden 文件，这是唯一能替代"源码正则"的东西；② **行为单测**：core 用例纯函数 + 注入假 storage，覆盖不变量（不许覆盖轮次、历史件先写、状态机转移）；③ **e2e**：保留真 HTTP 的 server.test.mjs，但把零 HTTP 的 loop.test.mjs 改叫集成单测，别让"e2e"这个名字提供虚假安全感；④ **对拍**：重构专用。**让假测试写不出来的办法只有一个：把不可测的代码变成可测的。** app.mjs 里那些源码正则的根因是 2382 行浏览器代码没有 DOM 环境，抽薄 + 事件委托后大多能变成对纯函数的断言。确实测不了的（mermaid 真实渲染、缓存击穿）承认它是**静态守卫**，单独放 `tests/guards/` 并**在总数里分开计**——今天 618 这个数字里混着上百条静态断言，会让人系统性高估安全度。

**Q8 · 可调试性？**
三件事：① **日志规范**——统一 `[wb:<层>:<用例>]` 前缀 + 结构化字段（session/round/identity/耗时/结果），入口一条、异常一条、返回一条；今天 `console.error` 散落且格式不一。② **journal**——stream 的 append-only JSONL 已经是对的底座，把它从"聊天记录"正名为 `journal.jsonl`，所有状态变更（round-created / feedback-submitted / round-claimed / round-responded / participant-added / revoked）都写一条：人可读、git 可 diff、崩溃后可回放，顺带解决"谁覆盖了内容"这类事故取证。③ **线上自检**——health 扩成 `{version, commit, assetsVersion, uptime, sessions, latestRoundAt, listenerHeartbeatAt}` + `check-deploys.mjs`。另外必须顺手修风险 #5 那个"把所有异常翻译成 invalid JSON"的反调试代码，以及 `listener.mjs:221-232` 每 10s 给全部会话写心跳——它把 mtime 搅浑，让"最近谁变了"这个最基本的排查手段失效。

---

**不确定、需要用数据确认再决策的两项**：① stream 的 `ask/answer` 是否被真实使用过（简报无此项统计）；② 三台部署当前实际的启动与同步方式，我只核实了仓库内的脚本与 CI，未登录生产机核对。
