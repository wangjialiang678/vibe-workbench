# Codex 独立架构评审（2026-08-30）

## 判决

结论：**不做绿地全量重写；以文件为事实源做一次绞杀式核心收敛，并砍掉五个低证据产品面。**
37 个会话的核心闭环已经被验证，不能为整洁牺牲客户门户；但 694 块中前五类型占 81%，而
`executor-inbox`、控制塔、项目注册表和文档/对话面正把复杂度从核心路径抽走。

### 逐子系统判决表

| 子系统 | 判决 | 一句依据 |
|---|---|---|
| `src/protocol/` | 改造复用 | schema、diff、attention 是浏览器/服务端共用的纯函数，稳定 id 多轮机制已有 16 个会话使用；应升级为版本化契约，不重造语义。 |
| block 类型注册表 | 原样复用 | 12 个类型已有注册表，且五大类型已覆盖 81% 使用量；保留旧类型的只读兼容，新增类型必须伴随契约夹具。 |
| `src/workspace.mjs` | 改造复用 | `writeRound(...allowOverwrite:false)` 已以原子 `mkdir` 防重写；但通用 `writeJSON` 仍可绕过不变量，必须收口为仓储 API。 |
| content/feedback/status 存储 | 改造复用 | 文件兜底曾救场，且 `feedback-history` 已补过 2026-08-19 覆盖事故；保留文件，改为唯一写入者和可审计事件。 |
| `src/server/server.mjs` | 重写 | 1,215 行仍是“服务定位器”：routes 反向 `import '../server.mjs'` 取得几十个符号，边界虽拆文件但依赖方向未拆。 |
| `src/server/routes/` | 改造复用 | 路由次序、token 前置及 403/404 语义有明确契约（`routes/README.md`）；保留 URL/鉴权行为，handler 改只调用用例。 |
| participants/鉴权/可见性 | 改造复用 | owner、参与者、自报身份三层历史包袱风险高；将身份解析和 block/feedback 可见性固化为一个授权服务，先做行为金样。 |
| `src/render/app.mjs` | 改造复用 | 2,382 行无导出且混合轮询、DOM、提交、对话、文档；已抽出若干纯模块，继续拆 controller，不重写成熟 block 渲染。 |
| `src/render/blocks.mjs`、theme、纯 view | 原样复用 | 视觉令牌和 mermaid 容错有真实线上病史及回归锁；只让 renderer 依赖协议/DTO，保持白底主题成果。 |
| `src/loop/` | 改造复用 | ack → driver → response/error 与启动对账是核心恢复能力；改为调用 `ProcessFeedback` 用例，driver 仍是可注入 adapter。 |
| `src/executor-inbox.mjs` | 砍掉 | 532 行、生产 0 条任务；其租约/恢复逻辑不能以“可能会用”占据常驻 server 和控制塔依赖。先只读归档，需求复现后再独立建。 |
| `src/control-tower.mjs` 与 control UI | 砍掉 | 664 行、无持久化真实数据，却聚合远端、systemd、磁盘、日志；这不是客户评审闭环，且扩大权限和部署面。 |
| `src/projects.mjs`/项目目录 UI | 砍掉 | 469 行、几乎无真实使用；会话的 `projectId` 作为不解释的兼容元数据保留，移除注册表、目录与跨项目执行路由。 |
| `src/documents.mjs`/documents UI | 砍掉 | 仅 1 个会话使用；将已有 Markdown/附件保持可读，停止发布、目录和编辑产品面。 |
| `src/stream.mjs`/对话栏 | 砍掉 | 仅 6/37 会话、共 19 条，且已默认折叠；保留 `sessionComment` 与反馈回执，移除即时消息、ask/answer 和轮询。 |
| 部署与静态资产版本 | 改造复用 | `assetsVersion()` 和 `?v=` 已解决缓存送达，但三处 rsync 仍会漂移；发布单元必须从“复制源码”改为不可变版本。 |
| `docs/DESIGN.md` | 重写 | 502 行规格仍把已判死的 stream/documents/control-tower 写成主设计；迁移完成后以目标契约和运维验收替换。 |

## 目标架构

依赖只能向内：`transport(http/CLI/worker) → application use cases → domain(protocol + authorization)`；
`application → ports → infrastructure(file repository, clock, journal, driver, notifier)`；`render → protocol + API DTO`。
domain 不 import Node、文件或浏览器；application 不 import `http`/DOM；infrastructure 不反向 import route；
composition root 是唯一能把实现注入 use case 的位置。用一条 import-graph 架构测试拒绝逆向边，不能再让
route 从 server 主模块反向拿杂项函数。

文件布局继续以 `workspace/<session>/round-N/` 为可直接接管的事实源：不可变 `content.json`、
每次提交的 `feedback-history/*.json`、当前反馈投影 `feedback.json`、`ack/response/error` 和
`status.json`。新增每会话追加式 `journal.ndjson` 记录领域事件及关联文件名；它是审计/诊断索引，
不是取代文件的第二事实源。所有写入只经 `SessionRepository`，内容轮以目录预占提交，其他文件以临时文件
`rename` 提交；禁止业务代码直接 `fs.*`。

一轮流：`POST present` → `PresentRound` 校验 protocol、分配/预占轮次、写 content/Markdown/status、记
`round.presented` → render 取 DTO（含 diff/可见性）→ `POST feedback` 经授权和 schema 校验，先追加历史、
再原子刷新当前投影/status、记 `feedback.submitted` → listener 的 `ProcessFeedback` 以 ack 认领、调 driver、
写 response/error 与 journal；新一轮仍只由 `PresentRound` 生成。读任何落盘物即可重建当前状态和继续处理。

## 迁移分期与验收

| 阶段 | 范围 | 可验证验收标准 |
|---|---|---|
| 0. 冻结行为 | 不改生产路径；用脱敏、合成夹具固定 protocol、权限、路由次序和核心文件树。 | 当前 `npm test` 基线 **618 pass / 0 fail**；建立五大 block、参与者可见性、重提反馈、失败恢复的 golden；新旧服务对同一夹具跑简报所述 **42 请求**，状态/体/文件树逐项 diff。 |
| 1. 收口存储 | 先实现文件仓储与 journal，`workspace.mjs` 只作兼容 facade；不迁移客户数据，不变路径。 | 并发同轮只有一个成功；故障注入在每次写的任一点后重启，文件可读且不会出现半个 content；现有 618 全绿，新增仓储行为测试全绿。 |
| 2. 核心用例 | 建 `PresentRound`、`SubmitFeedback`、`ReadRound`、`ProcessFeedback`、授权服务；route 逐个改注入用例。 | `/api/rounds/content/feedback/status/retry` 的方法、状态码、403-vs-404、响应和落盘与旧版 42 请求完全一致；双 server 对拍连续通过三次。 |
| 3. 渲染与 loop | 将 app 的装配、轮询、提交各拆 controller；listener 改调用例，保留 mermaid/资产版本回归。 | 浏览器冒烟：首轮、diff、提交、刷新后草稿、反馈失败重试、listener 崩溃后 reconcile；冷启动只凭夹具文件处理一轮成功。 |
| 4. 删枝与上线 | 从导航、route、server timer 和部署包移除 inbox/control/projects/documents/stream；旧数据只读导出/归档。 | 生产前后新旧版本分别对门户夹具及 42 请求对拍；三部署返回同一 release manifest；连续 7 天 journal 无未知事件/404 后才删除兼容读取器。 |

## Top 5 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重构时破坏 token、参与者和“无 token 未知 API 也 403”的隐式顺序 | 阶段 0 把矩阵变成黑盒 HTTP golden；鉴权在 transport middleware 保持先于 route match。 |
| 新仓储再次造成内容/反馈覆盖或半写 | 单一 writer、目录预占、临时文件 rename、历史先写；每个写点做 crash-restart 故障注入。 |
| 砍低频功能却碰到客户正在用的存量页 | 先从 UI/新写入下线，保留只读导出和 7 天可观测窗口；不删除客户文件。 |
| 新旧并行的差异只被 618 单测掩盖 | 42 请求双 server 对拍成为每阶段 gate，比较 HTTP 语义和文件树，不只比较源码/函数。 |
| 三服务器仍各跑不同版本或缓存旧 UI | 发布不可变 bundle + manifest/SHA，健康端点报告 release/schema/assetsVersion；部署后逐台探针验证三值相同。 |

## Q1–Q8

### Q1：零依赖与无构建是否保留？

保留 Node 内置 HTTP 和浏览器原生 ESM；当前规模不是引框架/构建器的收益点，`app.mjs` 的问题是职责而非语法。
不现在引 SQLite/esbuild：SQLite 会增加备份/迁移/跨三机运维，esbuild 会多一条产物送达链；两者都不能修复反向依赖。
触发条件才引：需跨会话查询/并发写吞吐且文件索引实测成瓶颈时评估 SQLite 投影；需模块数导致冷启动/发布显著受损时评估 esbuild。

### Q2：文件还是 DB？

文件继续是事实源：`feedback.json` 直读兜底已经实战救场，37 会话规模也不证明 DB 的必要性。
采用“文件事实源 + 原子仓储 + journal + 可再建投影”，而非双写 DB；以后 SQLite 只能从 journal/file 重建的查询索引，不能成为真相。
先修 85+ 分散 `fs.` 写入所带来的不变量绕过，收益远大于换介质。

### Q3：怎样切层并强制方向？

按目标架构的 domain/application/ports/infrastructure/transport/render 切；protocol 归 domain，文件和 driver 均为 adapter。
以 composition root 注入依赖，删除 routes 对 `../server.mjs` 的反向 import；每层只暴露窄 DTO/port。
CI 加 import-graph allowlist（结构守卫），同时用黑盒行为测试防止“为了过图测试而空拆”。

### Q4：哪些该砍？

砍 inbox、control-tower、projects registry/UI、documents 写面、stream/ask 面；数据分别是 0、几乎 0、几乎 0、1 会话、6 会话 19 条。
砍错代价是少量历史访问，不是丢数据：归档并提供只读文件/导出；真正重新出现需求时以独立边界重建。
保留 sessionComment、feedback history、附件和 `projectId` 兼容字段，避免把“砍产品面”误做成删客户事实。

### Q5：绿地还是绞杀？

选绞杀：客户门户不能长停，且 content/feedback 文件契约、protocol、mermaid 修复均是应复用资产。
允许在内部绿地写新 use case/repository，但从兼容文件树读写，按 endpoint 切流；不做一次性数据迁移。
42 请求新旧双服务逐行/逐文件对拍是每个切换门槛，连续三次通过后才替换旧路径。

### Q6：如何根治三份部署漂移？

每次发布生成一个不可变 release bundle（含源码、vendor、manifest、release SHA），三机只安装同一件，不 rsync 工作树。
`/api/health`（受 owner 运维鉴权）返回 release SHA、schema 版本、assetsVersion、启动时间、listener 状态；部署脚本逐台探针比对。
保留 HTML 的 `?v=`/资产版本握手；它解决浏览器送达，不替代服务器版本自检。

### Q7：测试架构？

protocol golden 覆盖 schema/diff/可见性；纯 domain/application 用行为单测；仓储做故障/并发测试；HTTP e2e 覆盖权限与状态机；最后做双服务对拍。
源码正则仅允许 CSS token、import 边界等静态守卫，禁止承载产品行为；现有 `render.test.mjs`、`present.test.mjs` 的源码匹配逐步用浏览器/HTTP 行为替代。
gate 顺序：快速单测 → 仓储故障注入 → e2e → 42-request 对拍 → 三机冒烟；任一失败不迁移。

### Q8：可调试性怎么设计？

结构化日志固定 `time,release,requestId,session,round,actor,operation,outcome,latencyMs,errorCode`，不记录 token、正文或附件内容。
journal 记 `round.presented/feedback.submitted/claimed/responded/failed/retried` 与文件引用，状态从文件可重建，避免全量 event sourcing。
health/readiness 检查 release、工作区可读写、schema、资产版本、listener/worker 心跳和最近错误；冷启动探针用独立夹具完成一次接管。

## 证据与不确定性

- 使用量与事故来自事实底稿 [00-briefing.md](../00-briefing.md)：37/71/42、类型分布、0 inbox、覆盖/缓存/权限事故。
- 代码证据：原子 round 预占在 `src/workspace.mjs`；反馈历史先写在 `src/server/routes/feedback.mjs`；反向依赖在所有 `src/server/routes/*.mjs` 的 `../server.mjs` import；`app.mjs` 为 2,382 行浏览器协调器。
- 已实测基线：2026-08-30 `npm test` 为 **pass 618 / fail 0**（43 个测试文件）。不确定的是被默认收起功能是否有未记录的外部客户依赖，故采用只读归档与上线观察，不直接删除数据。
