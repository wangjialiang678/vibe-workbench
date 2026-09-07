# 决策卡分型采集（三件先试 ②，设计 v1，2026-09-07）

> 依据：user-vibeloop docs/19 PRD §四；D39（Michael 采纳"不可逆决定先不显示 AI 推荐"试点）；D40（并行开发、分批启动）；D36 对齐约束（tms-c6 2026-09-07）：**分型只调决策负担，不调上下文完整度**。
> 证据与边界：AAAI 2022 选择性预测研究——告知"系统决定转交"提升人类判断、同时展示 AI 原判断反而拖累；**推广到架构/业务判断是迁移假设**，故本试点带预登记判据。R15F：采集"选择+当时的预测+前提"比采集"理由"可回测（Nisbett & Wilson 1977 事后合理化）。

## 1. 判据（预登记，不得事后改）
- 成功：盲判卡的**改选率**（最终选择 ≠ AI 推荐的比例）或**预测采集率**（填写 prediction 的比例）与快批卡出现可辨差异，且顾问未流失（提交率不降）。
- 失败：两指标与快批卡无差异、或提交耗时明显拉长且有抱怨 → 盲判卡退回可选特性，不默认启用。
- 度量口径：`card-metrics.json`（§4），聚合 CLI 出数；试点期 4 周或累计 20 张盲判卡，先到为准。

## 2. 协议：在现有 `choice` 块上加 `mode`
```jsonc
{ "type": "choice", "mode": "blind" | "quick",      // 缺省 quick ＝ 现状，逐字节不变
  "judgmentKind": "fact" | "preference" | "prediction",   // 可选：事实/偏好/预测
  "supersedes": "D33",                                     // 可选：本卡推翻/修改的既有决策编号
  "background": "...", "why": "...", "options": [...pros/cons...],
  "recommendation": "a", "recommendReason": "..." }
```
- **blind**：`recommendation`/`recommendReason` 照常提交与校验，但**提交前不渲染**（无「推荐」标、无 data-recommended、无 data-default-check 预选）；提交后在本轮只读视图显示「AI 分析（提交后可见）」段。
- **quick**：现状。推荐预选、一键通过。
- **上下文密度相同（D36）**：两型都要求 background/why/options pros-cons 齐全；`decisionMissingFields` 与 `lint` 对两型一视同仁。
- `judgmentKind: fact` → 渲染提示条「这是事实类问题，宜转外部信源/客户确认」，并允许 `defer` 选项自动追加（"转外部确认"）。
- **D36 三段式（D41 病例 #2）**：若 `supersedes` 非空或 background 含 `/D\d+/`，lint 要求 background 内含「现行」「本次改」「不动」三个小节关键词，缺则 warn `missing-supersede-frame`（不阻断）。
- 批量：同轮 blind 卡 > 5 → lint warn `too-many-blind-cards`（决策疲劳，R15F 打断实证）。

## 3. 采集：选择 + 预测 + 前提
blind 卡在选项下方增两栏（quick 不加）：
- `prediction`（textarea，占位「你预计这样选之后会发生什么？」）
- `premises`（textarea，占位「什么情况变了，这个决定要重新议？」）
提交载荷（`submit-payload.mjs`）：`{blockId, type:'select', value, comment?, prediction?, premises?}`；feedback.json 原样落盘；lint：blind 卡提交时两栏皆空 → 前端软提醒一次，不阻断。

## 4. 度量：`round-N/card-metrics.json`
提交时由服务端写入（与 feedback.json 同事务）：
```jsonc
[{ "blockId":"b-x", "mode":"blind", "judgmentKind":"preference",
   "recommendation":"a", "selected":"b", "changedFromRecommendation":true,
   "predictionProvided":true, "premisesProvided":false,
   "openedAt":"…", "submittedAt":"…", "dwellMs":184000 }]
```
CLI：`node bin/workbench.mjs card-metrics <session> [--since 30d]` → 按 mode 汇总 改选率/预测采集率/前提采集率/平均停留/提交率。这就是判据的数据源；将来 scorecard(kind:"card") 复用同结构。

## 5. 交付物与验收
1. `src/protocol/block-types/choice.mjs`：mode/judgmentKind/supersedes 校验；blind 渲染隐藏推荐与预选；两栏采集；lint 三条（missing-supersede-frame / too-many-blind-cards / blind-empty-capture 仅前端）
2. `src/render/app.mjs` + `submit-payload.mjs`：prediction/premises 进载荷；提交后渲染「AI 分析（提交后可见）」
3. 服务端提交路径：写 `card-metrics.json`；`bin/workbench.mjs card-metrics` 子命令
4. `docs/authoring-guide.md`：决策卡两型 + 何时用 blind（不可逆/高后果）+ D36 三段式；`integrations/workbench-protocol.md`、skill 协议速查各加一行
5. 测试：① 缺省 quick 渲染与旧版逐字节一致 ② blind 渲染不含 rec-label/data-recommended/data-default-check ③ blind 载荷含 prediction/premises ④ card-metrics 写入且 changedFromRecommendation 正确 ⑤ supersedes 无三段 warn ⑥ >5 blind warn ⑦ fact 类提示条渲染
6. `npm test` 全绿；不新增依赖；不改 richpage/其他块
