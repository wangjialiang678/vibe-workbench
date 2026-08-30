# Codex 独立方案评估（2026-08-30）

**结论：需要补 3 项定义后再进入实现，不能直接开工。** 分层/绞杀方向正确，
但执行面被混成两条现有链路，storage 边界也尚不可实施；照文档开工会在第 4 期
得到“绿了但没有证明真实链路”的结果。

## A. 对 D1–D10 的忠实性

| 决策 | 结论 | 依据 |
|---|---|---|
| D1 中间态 | **部分落实，存在阻断性缺口** | 02 §1、§2 明确只有 storage + 薄 core，符合“不做全量 DI/所有端点套用例”。但“fs 只准 storage/CLI”（02:27）与现状不兼容：静态服务必需 `src/server/routes/pages.mjs:35-88` 的 fs，且 workspace/config/inbox 文件 I/O 分散于 `src/projects.mjs`、`participants.mjs`、`stream.mjs`、`executor-inbox.mjs`、`control-tower.mjs`、`loop/agent-exec.mjs`。未先定义这些归 storage、server-static 例外，守卫无法成为可执行契约。 |
| D2 保留、默认关、真 e2e | **未忠实落实** | 02 §3 只列 loop、inbox 路由、control-tower；漏掉真实执行面的 `scripts/local-listener.mjs:674-766` 与 `scripts/resident-worker.mjs:980-1201`。两者分别领取/执行 inbox 和 Codex，不能由“loop 不启动”关闭。更关键的是现 listener 根本不走 inbox：`src/loop/listener.mjs:171-185` 直接扫描 feedback，`processRound` 只写 ack/response（:50-130）。 |
| D3 `claude -p --resume` 必需 | **方向落实，验收遗漏** | `src/loop/agent-exec.mjs:17-20` 已组装 `-p … --resume`，`listener.mjs:76-99` 保留并回写 session id；02/03 没要求 on 态验证真实 driver adapter 的 argv/续接 id，只测假 driver，不能证明 D3 的关键调用仍在。 |
| D4 owner-only RCE 不额外处理 | **落实** | 02 未增加 D4 范围外缓解；现 inbox 已 owner gate（`routes/inbox.mjs:16-20`）。 |
| D5、D6 已上线修复 | **未推翻，测试有固化意图** | 03 §5:63-65 继续列可见性与 `_lab` 回归，没有重做机制。 |
| D7 不做发布自动化 | **落实** | 02 §5 仅 `/api/health` version；无 manifest/SHA/三机发布设计。 |
| D8 文件事实源 | **部分落实** | 02 §4:66 与 03 §4:57 有冷启动夹具测试。但 `session-store.mjs:33-40` 也写 session，`stream.mjs`/projects/inbox 各自写文件；storage API 未涵盖它们，不能保证“可由 storage 重建”的统一事实源。 |
| D9 零依赖无构建 | **落实** | 02:28 提供 dependencies 守卫，`package.json:9-16` 现无 dependencies；render 仍原生 ESM。 |
| D10 绞杀式 | **基本落实，基线定义缺失** | 02 §5 分期和 03 §2 的对拍是绞杀式。可是“基线 commit”未冻结为可复现的 tree-ish/副本；同一可写 workspace 也会被 POST 改写，不能安全对拍。 |

## B. 分期与验收

顺序 **0→1→2→3** 正确：先冻结外观行为，才收 storage、断循环。第 4 期应在
第 2 期确定“pending/claim/response/next-round”的数据契约后再做；目前该契约没有
列入第 2 期，故第 4 期不能独立验收。

- **第 1 期对拍会测假。** 03:22 说两 server 共用“只读”夹具，却要求全部端点；POST
  `/api/rounds`、`/api/feedback`、inbox claim/complete 会写入并互相污染。应为每个 server
  复制同一初始夹具、逐条重置，或仅 GET 对拍并把写请求改为成对状态迁移对拍；否则
  “零差异”没有意义。
- **第 2 期并发验收不够。** “主件为最后一笔”没有定义并发下的排序依据；当前名称由
  进程内 `feedbackHistorySeq` 构成（`routes/feedback.mjs:128-153`），多进程/重启可碰撞。
  还应断言历史文件名唯一、每笔 payload 可回读，并通过跨进程或可注入 id/clock 复现。
- **第 2 期“每写点中断”会测假。** 普通 `writeFileSync` 并非原子（`workspace.mjs:55-60`），
  只有 inbox 自己实现 temp+rename（`executor-inbox.mjs:112-127`）。先规定 storage 全部写入的
  临时命名、fsync/rename 语义及故障注入点，再谈中断测试。
- **第 3 期 `export ≤5` 是形状指标，不是行为指标。** 现 `server.mjs:991-1086` 的巨型 export
  是 routes 对 server 的反向依赖症状；限制数字可促成任意 re-export barrel，须同时以
  “routes 不 import composition root、handler context 来自独立 http/auth 模块”验收。
- **第 4 期会测到不存在的链路。** 03:53 写“present→claim→…→next-round”，而现 listener
  的 ack 不是 inbox claim，driver 结果是 `response.md`，不会创建 content（`listener.mjs:50-104`）。
  若实现临时造一条测试专用串线，测试可过但 D2/D3 的 local/resident 执行面仍未被验证。
- **第 5 期 health 版本号太晚。** D7 只保留的调试能力应放 0/1；当前 health 仅 `{ok,ts}`
  （`routes/health.mjs:1-5`），后置没有依赖收益。

## C. harness / golden / 假 driver 的覆盖力

这套骨架足以显著降低**纯 GET/渲染重构**的漂移风险：近似路径、2s 超时、反向自检和
`computeDiff/routeBlocks/renderZones` golden 是正确组合（03 §2、§1）。但尚不足以放行：

- golden 只覆盖 5 类 block、称 81% 用量（03:12），未覆盖 visibility、participant feedback
  bridge、错误 JSON/空文件、legacy session 路径和 assets/import-map；这些恰在服务端拆分边界。
- 对拍归一化 `ts/assetsVersion`（03:23）必须采用白名单字段归一化并断言其余 header、status、
  body、连接终止一致；否则会掩盖 auth/cache 退化。POST 则须按上条隔离 fixture。
- 假 driver 是必要的，却只验证“driver 被调用”。应另加 adapter 契约单测：Claude argv 包含
  `-p --resume <id>`、session id 持久化/agent 切换、timeout/非零退出；现有关键实现分别在
  `agent-exec.mjs:17-20,413-460` 与 `loop/session-store.mjs:20-39`。
- 还缺 local-listener/resident-worker 的真 HTTP e2e（以 fake fetch/spawn）：领取、续租、执行、
  complete、崩溃回收，以及 `WB_CLOUD_AI=off` 对每个入口的禁止/展示语义。

## D. 过度设计与遗漏的真耦合

没有发现 01 明确否决的六边形、全端点 use-case、版本迁移、事件回放或不可变发布包回流。
`PROTOCOL_VERSION + 顶层 version` 是 D1 允许的保险，不是迁移系统。

反而遗漏两处应拆的真耦合：

1. routes 从 `../server.mjs` 导入整包（例如 `routes/session.mjs:1-34`、`feedback.mjs:1-21`），
   与 server 对 `routes/index.mjs` 的导入（`server.mjs:72`）形成环；02 已识别，但未给共享模块
   的责任表，极易把 94 exports 搬成另一只“大 helpers”。
2. “轮次自动续跑”和“项目 executor inbox”是不同状态机：前者以 `ack.json/response.md/status.json`
   运行，后者以 `pending/claimed/done/failed` task 运行（`executor-inbox.mjs:9-14,322-355`）。
   必须明确是保留两条、由 event 映射连接，还是合并为一条；不可用一个 `driver` 接口模糊带过。

## E. 最危险的三个实现陷阱

1. **把 ack 当 inbox claim。** `listener.mjs:50-64` 的 `exists→writeJSON` 不是原子 claim，两个
   进程可同时越过 exists；inbox 则正确以 rename 竞争（`executor-inbox.mjs:185-210`）。不能复用
   前者的“ack 锁”来宣称 D2 的多 worker 幂等。
2. **迁移时丢失 HTTP/CLI 副作用差异。** CLI `cmdRender` 仅 `writeRound`（`bin/workbench.mjs:68-75`），
   HTTP rounds 另写 project metadata、stream receipt、dispatch（`routes/session.mjs:83-121`）。
   `core.presentRound` 的输入/返回/副作用未定义，直接合并会悄悄改变其中一路。
3. **错误被错误分类为 JSON。** feedback handler 的整段异步链统一 catch 为 400 `invalid JSON`
   （`routes/feedback.mjs:48-175`），包含历史件、主件、status、stream 写盘失败。storage 改为
   原子写后必须保留真实 errno 并使 handler 映射 5xx，且不可把真实路径/敏感数据直接回传。

## F. 放行条件（一句话）

**需要先补：① workspace/static/config/inbox 的 fs 边界与例外表；② 两条执行状态机的唯一
数据流、开关覆盖矩阵和“下一轮”所有者；③ 隔离可写 fixture 的对拍及真实 adapter 续接契约，
再进入实现。**
