# 融合与批注体验设计文档 — PRD 工作台并入 Vibe Workbench

- 日期：2026-07-02
- 作者：产品架构 + 交互设计
- 目标读者：Vibe Workbench 维护者（后续只维护本项目）
- 输入：6 份盘点/调研报告（PRD Review Studio 代码盘点、Vibe Workbench 代码盘点、批注 OSS 选型、批注交互调研、"重复内容/找不到新点"机制调研、内容质量与场景化测试调研）
- 修订：2026-07-02 v2 —— 吸收 3 份对抗式审查（可行性/痛点契合/缺口）。关键更正见 §0.1「审查更正记录」。

---

## 0. 结论摘要（TL;DR）

- **一个项目**：PRD Review Studio（studio.js / demo.js，6 个"面"）的全部能力，都能用 Vibe Workbench 现有的 **block 协议 + 模板 + 注意力分区 + 轮次 diff** 表达。融合方式是"翻译到 block"，不是"搬代码"。新增件仅 3 类：① `prototype` block 类型（承载 proto/ui 的 iframe/图片 + 定位批注）、② `checklist` block 类型（承载 completeness 自查）、③ 统一批注数据模型 `annotations[]`。
- **场景先行**：不做一个"六面通吃"的巨型页面。先判断 4 个场景（开发 PRD 评审 / 泛场景方案确认 / 设计可视化 / 文档共创），每个场景用不同模板、不同 block 组合、不同批注方式、不同呈现风格（结构化 vs 自由）。
- **批注统一**：文字锚定（飞书式，已有 embed rail）为主；截图/原型定位批注 **复用 Annotorious v3 + Recogito text-annotator-js**（BSD-3、同作者、W3C 数据模型对齐、纯前端），不自研。两者在"左内容右评论栏"下用**同一条 `annotations[]` 数据 + 同一个评论栏**统一，selector.type 分发渲染。
- **根治重复感（根因已更正）**：真根因是 **`routeBlocks`（attention.mjs）从不读 `_change`**——注意力路由和 diff 是两套没对齐的系统，unchanged 块照样进 zoneContext/zoneA/B 顶在最前，"只看变更" toggle 只是给半脱节的开关打补丁。核心修复=**让 `_change` 参与分区**（改动 A'），配合顶部"本轮待确认 N 项（新增 M/改动 K）"、已决项沉降、AI 已采纳回执。见 §4。
- **痛点③载体先修**：`renderVerdict` / `blockHtml` **当前根本不渲染 `block.body`**（blocks.mjs:80-90 / 163-176），§5 的"去黑话 body"若不先让 body 上屏就全部落空。批次 0 先补这一行渲染。见 §5.0。
- **批注系统后置（非本轮）**：四痛点没有一个是"批注能力不足"；Annotorious/Recogito 整条线与四痛点无关，且与 Vibe 零依赖 ESM + 无打包步骤架构冲突（见 §3.0）。降为"出现原型/UI 评审场景再启动"，不占本轮工期。
- **PRD 工作台可弃用判据**：见 §1.7，达成即删除旧仓。

---

## 0.1 审查更正记录（v2）

三份对抗式审查中，以下有效批评已吸收进正文：

| 编号 | 批评 | 更正 | 落点 |
|---|---|---|---|
| C1（P0，根因错判） | 痛点①真根因不是"toggle 未默认勾选"，而是 `routeBlocks` 不读 `_change`，unchanged 块无条件进 zoneContext/zoneA/B | 新增**改动 A'**：`routeBlocks` 让 `_change` 参与分区，作为批次 0 P0；原改动 A（toggle 默认）降为辅助 | §4 改动 A' |
| C2（P0，载体落空） | §5"去黑话 body"写进 `verdict` 从不渲染的字段（blocks.mjs 无 body 渲染路径） | 批次 0 先补 `renderVerdict`/`blockHtml` 渲染 `block.body` | §5.0 |
| C3（P0，可行性） | Annotorious 是 5 个运行时依赖的 npm 包，Vibe 零依赖、无打包步骤、浏览器不认 bare specifier；iframe 内 Annotorious "注入"无实现路径 | 批注系统整体后置；本轮定位批注只用**自研零依赖 SVG pin 层**（wireframe/image 用百分比、iframe 用外层 overlay），Annotorious/Recogito 推迟到引入构建步骤时 | §3.0 / §3.2 |
| C4（P1） | `blockFingerprint`（schema.mjs:27-37）不含 `prototype.src`/`checklist.items` 等新字段，diff 对新 block 类型失效 | `blockFingerprint` 改为按 type 扩展 subset（含新字段）；见 §1.4 尾 | §1.4 |
| C5（P1） | 改动 C 的 `_decidedInPrev` 注入依赖前轮 feedback 文件存在，缺 null guard；批次 2 fixture 未含"前轮 feedback 缺失"场景 | 明确 null guard + 补 fixture 场景 | §4 改动 C |
| C6（P1） | 改动 A 的 `<details>` 折叠若改 `blockHtml` 会连 zoneContext 的 unchanged 叙述块一起折叠（违反"绝不折叠"） | 折叠只由 `renderZones` 在 zoneA/B 分区里按 `_change` 决定，不改 `blockHtml` | §4 改动 A' |
| C7（P1，优先级倒置） | 改动 E"AI 已采纳回执"是痛点①的正面解法，不该压到 P2 | 从 P2 提到批次 1 | §4 / §6 |
| C8（P2） | 移动端 long-press 与 iOS Safari 原生手势冲突；`comments[]`→`annotations[]` 迁移会丢历史草稿；checklist 复合 refId 无 schema 支持 | 均记为批注批次（后置）的验收/迁移前置条件 | §3.5 / §3.4 / §1.4 |

以下批评**未吸收**并说明理由：
- 审查 3 建议新增 S5「多版本设计对比」/ S6「数据看板验收」、嵌套回复 threads、视频批注、IndexedDB 离线、块间 `linkedBlockId` 关联、旧仓 readonly banner + analytics 埋点、模板 version 字段等——判为 **YAGNI/超范围**。四痛点无一涉及；这些属"盘点驱动"而非"痛点驱动"，列入 §7「明确不做（本轮）」备查，真出现场景再评估。

---

## 1. 融合架构与迁移

### 1.1 融合总原则

PRD Review Studio 是"六面写死 + LocalStorage 轮次"的专用工作台；Vibe Workbench 是"block 原语 + 模板 + 注意力路由 + 服务端轮次 + 异步唤醒"的通用框架。融合方向唯一正确的是：

> **把 PRD 工作台的每个"面"翻译成 Vibe 的 block 序列（由模板工厂产出），而不是把 studio.js 的渲染逻辑搬过来。**

理由：Vibe 已具备 PRD 工作台缺的东西（服务端轮次、diff、注意力分区、异步唤醒、容错），而 PRD 工作台只多两样 Vibe 没有的：**原型/UI 的定位批注**与 **completeness 自查的结构化清单**。融合的净新增面很小。

### 1.2 现有 block 类型盘点（Vibe，`src/protocol/constants.mjs:2`）

`markdown · diagram · choice · verdict · freetext · editable · table · code · embed`（9 种）。反馈类型 `select · verdict · comment · edit · text · pin`（`constants.mjs:5`，注意 **`pin` 已在枚举内**，定位批注的数据通道天然存在）。

### 1.3 逐面映射：PRD 六面 → Vibe block/模板/新增件

| PRD 面 | 数据结构（旧） | Vibe 实现 | 用什么 block/模板 | 需新增件？ |
|---|---|---|---|---|
| ① PRD 评审 (prd) | sections[].items[]（cid/title/body/ac/defaultVerdict/important） | 每条 item → 1 个 `verdict` block；`important` → `importance:'high'`；`defaultVerdict` → `default` | `dev-review.mjs` 的 `prdItems`（已有，`templates/dev-review.mjs:28`） | 否 |
| ② 交互原型 (proto) | screens[].widgets[]（x/y/w/h/cls/text/goto）+ 三模式(preview/edit/annotate) | 低保真原型渲染 + 定位批注。**wireframe 编辑（interact.js 拖拽）判定为可弃用**（见 §1.6），保留 preview + annotate | **新增 `prototype` block**（mode:`wireframe|iframe|image`）+ Annotorious 定位批注 | **是** |
| ③ UI 设计 (ui) | screens[].src（iframe 高保真）+ preview/annotate + 定位钉子 | `prototype` block（mode:`iframe`）；批注复用 embed 已有的 iframe 代理 + 定位批注浮层 | 同上 `prototype` block；文字锚定用现有 embed rail | 复用为主 |
| ④ 架构 (arch) | diagrams[](mermaid/rationale) + assertions[] + alternatives[] | 每图 → `diagram` block（已有 rationale 字段，`dev-review.mjs:42`）；assertion → `verdict` block；alternatives → `choice` block（options + recommendation=chosen） | `dev-review.mjs` 扩展 `archAssertions` / `archAlternatives` | 模板小改 |
| ⑤ 测试 (test) | scenarios[](name/expect/impact) + cases[](gherkin) | scenario → `verdict` block（body 用叙事，见 §5）；case/gherkin → `code` block(lang:'gherkin') 或折进 scenario 的 body | `dev-review.mjs` 的 `testScenarios`（已有）+ 可选 `testCases` | 模板小改 |
| ⑥ 完整性自查 (completeness) | journey/frSlots/wildFeatures/reconcile（各自 verdictCtlCustom 自定义按钮） | 结构化检查清单，每项三态自定义标签 | **新增 `checklist` block**（items[] 带自定义 verdict 标签组） | **是** |

净新增：`prototype` block、`checklist` block、统一 `annotations[]` 模型（§3）。其余全部由现有 block + 模板扩展承载。

### 1.4 新增件规格

**（A）`prototype` block**

```js
{
  id: 'b-proto-<slug>',
  type: 'prototype',
  title: string|null,
  mode: 'wireframe' | 'iframe' | 'image',   // 低保真线框 / 高保真iframe / 静态截图
  // mode=wireframe:
  screen: { id, name, widgets: [{ id, cls, x, y, w, h, text, goto }] },
  // mode=iframe:
  src: 'https://…',        // 经 /api/proxy 代理（复用 embed 现成通道）；定位批注用外层 SVG overlay（不进 iframe 内部，见 §3.2）
  // mode=image:
  imageUrl: '/assets/…png',
  needsDecision: false,     // 原型本身是"过目/批注"，不是决策；决策交给相邻 verdict/choice
  hasRecommendation: false,
  importance: 'normal',
}
```

渲染：`src/render/blocks.mjs` 新增 `renderPrototype(block)`，在 `blockHtml` 的 switch 增 `case 'prototype'`（`blocks.mjs:157` 同款）。**定位批注浮层用自研零依赖 SVG pin 层（百分比坐标）**——wireframe 直接复刻 studio 的百分比钉子；image 在图上叠 SVG overlay；iframe 在 iframe **外层**叠 SVG overlay（pin 坐标相对 iframe 元素的百分比，不依赖 iframe 内 DOM，规避跨域注入问题，见 §3.2）。这三种都是十几行 SVG + 百分比换算，零依赖、与现有架构零冲突。Annotorious/Recogito 推迟到引入构建步骤时再评估。

**（B）`checklist` block**

```js
{
  id: 'b-chk-<slug>',
  type: 'checklist',
  title: string|null,
  group: 'journey'|'frSlots'|'wildFeatures'|'reconcile'|'custom',
  verdictLabels: ['已覆盖','明确不做','待定'],   // 自定义三态（复刻 verdictCtlCustom，studio.js:617）
  items: [{ id, label, body, meta?:{states,inverseFlow,errorRecovery}, default? }],
  needsDecision: true,
  importance: 'normal',
}
```

反馈落地：checklist 的每个 item 落**一条独立 feedback**——`{ blockId: 'b-chk-xxx', type: 'select', value: 'itemId:verdictLabel' }`（不引入复合 refId，避免改 `validateFeedback`）。当前 `validateFeedback`（schema.mjs:83-93）只校验 `blockId`/`type`，此格式无需 schema 改动；`app.mjs` 的 `doSubmit` 构造 items 时按 checklist 的 items 逐条产出即可。这把 studio 的 `verdictCtlCustom`（自定义按钮标签组）泛化成通用件——顺带满足"completeness 从项目自查泛化为任意检查清单"的诉求。

**（C）`blockFingerprint` 扩展（C4，必改，否则 diff 对新类型失效）**

现状 `schema.mjs:27-37` 的 `blockFingerprint` 只哈希 `type/title/body/options/recommendation/default/value`——`prototype.src`/`prototype.screen`/`imageUrl`、`checklist.items`/`verdictLabels` 全不在指纹内，AI 改了原型 src 或 checklist 项目 → 指纹不变 → diff 误判 `unchanged` → 用户看不到变更。改法：`blockFingerprint` 的 subset 按 `block.type` 追加新类型的核心字段：

```js
// 在现有 subset 基础上追加：
if (block.type === 'prototype') Object.assign(subset, { mode: block.mode, src: block.src, imageUrl: block.imageUrl, screen: block.screen });
if (block.type === 'checklist') Object.assign(subset, { items: block.items, verdictLabels: block.verdictLabels });
```

（放在批次 3 新增 block 类型的同一提交里，作为验收前置。）

### 1.5 迁移步骤（把旧数据搬进来）

1. **写一个一次性转换脚本** `scripts/import-prd-project.mjs`：读 `demo.js` / `vibecoding-workbench.js` 的 `PROJECT_DATA`，按 §1.3 映射逐面生成 block 数组，落成 Vibe 的 `content/<session>/round-1.json`。纯数据转换，无 UI。
2. **模板扩展**：`dev-review.mjs` 增 `archAssertions / archAlternatives / testCases`；新增 `templates/design-review.mjs`（原型/UI 场景，产出 `prototype` + 相邻 `verdict`）。
3. **block 渲染**：`blocks.mjs` 增 `renderPrototype` / `renderChecklist` 两个 case。
4. **批注统一**：接入 Annotorious/Recogito（§3），统一 `annotations[]`。
5. **回归**：用转换脚本把 `demo.js` 全量导入，浏览器实测四场景（§2）跑通。
6. **删除旧仓判据达成后**（§1.7）→ 归档 PRD Review Studio。

### 1.6 明确"从旧仓丢弃"的能力（不迁移）

- **interact.js 的 wireframe 拖拽/缩放编辑**（studio.js:261-273）：这是"让评审者改原型坐标"的功能，实际低频且与"评审确认"心智冲突（评审者应批注意见，不该动稿）。**弃用**，只保留 preview + annotate。若将来需要，AI 侧改稿即可。
- **LocalStorage 轮次归档**（studio.js:22-32, rounds 队列）：Vibe 已有服务端轮次（`server.mjs:154` content by round + `feedback` 落盘），更强。**弃用旧机制**。
- **studio 的手机外框/主题切换等纯样式**：并入 Vibe 的 `app.css`，非核心。

### 1.7 PRD 工作台"可弃用"判据（全部满足即删旧仓）

1. `demo.js` 全量导入 Vibe 后，六面内容在四场景下均可正常渲染、批注、提交、进入下一轮。
2. 定位批注（原型/UI）在 Vibe 里可创建/编辑/跨轮可见，数据落 `annotations[]`。
3. completeness 四组自查在 `checklist` block 下三态可选、可提交。
4. 至少一个真实 PRD 评审在 Vibe 上完整走完 ≥2 轮，用户确认体验不劣于旧仓。
5. 旧仓再无独占能力（interact 编辑已判弃用）。

达成后：旧仓打 tag 归档，README 指向 Vibe，停止维护。

---

## 2. 场景分类 → 交互映射表

> 核心：**先判断场景再定交互，不同场景交互可以完全不同**。同一套 block 原语，不同模板 + 不同分区策略 + 不同批注模式 + 不同呈现风格。

| 场景 | 触发信号 | 模板 | 主力 block | 批注方式 | 呈现风格 | 分区策略 |
|---|---|---|---|---|---|---|
| **S1 开发 PRD 评审** | "评审这份 PRD/架构/测试" | `dev-review.mjs`（扩展） | verdict(PRD条目/测试场景) · diagram(架构) · code(gherkin) · checklist(完整性) | 条目级飞书文字锚定（内联 comment）；不需要定位批注 | **结构化**（逐条卡片 + 三态） | 强分区：zoneA/B 待决 + zoneC 沉降 + 已决折叠 |
| **S2 泛场景方案确认** | "确认下这个方案/让我选" | `think-discuss.mjs` | markdown(思路) · choice/verdict(决策，可多选可带推荐) · diagram | 自由文字锚定（选中即评）；决策块用 choice | **半结构化**（叙事 + 少量决策点） | 中等：zoneContext(叙事可见) + zoneB(带推荐决策) |
| **S3 设计可视化** | "看下这个原型/UI/截图" | `design-review.mjs`（新） | prototype(iframe/image/wireframe) · 相邻 verdict/choice | **定位批注为主**（本轮：自研 SVG pin 点选；目标态：Annotorious 点/框选）+ 侧栏文字评论 | **自由**（画布 + 右评论栏，Figma 式） | 弱分区：内容区一屏原型，右栏评论列表；决策收在底部 |
| **S4 文档共创** | "一起改这篇文档/共创" | `think-discuss.mjs`（doc 非 null → editable） | editable(正文) · markdown | **文字锚定 + 就地编辑**（本轮：已有 embed rail 选区式；目标态：Recogito 选区评论）+ editable 直接改 | **自由**（Google Docs 式：正文流 + 右侧评论对齐） | 极弱分区：正文为主，评论栏与高亮垂直对齐 |

呈现风格判定口诀：
- 内容主要是"待确认的离散条目" → **结构化**（卡片 + 三态 + 强分区）。
- 内容主要是"连续叙事/画布/正文" → **自由**（内容区 + 右评论栏 + 弱分区）。

来源支撑：Figma 双向联动（画布 pin ↔ 侧栏条目）适配 S3；Google Docs 评论垂直对齐适配 S4；Zeplin"永久批注 vs 临时评论"分离思路用于 S3 的 annotation/comment 区分。

---

## 3. 批注系统统一设计

### 3.0 可行性前提与本轮范围（v2 更正）

**关键更正**：本轮定位批注**不引入 Annotorious/Recogito**，改用自研零依赖 SVG pin 层。原因（对抗式审查 C3）：

1. **Vibe 是零依赖 + 无打包步骤的 ESM 项目**：`package.json` 的 `dependencies` 为空，`src/render/*.mjs` 由浏览器直接作为 ES 模块加载（`server.mjs` 静态伺服 `src/`）。`import '@annotorious/annotorious'` 这类 bare specifier 浏览器不认，必须先引入构建步骤（vite/esbuild 打成 vendor bundle，同 `mermaid.min.js`）或走 CDN ESM URL（联网 + CSP 风险）。Annotorious v3 自身带 5 个运行时依赖（`@annotorious/core`、`nanostores`、`rbush`、`dequal`、`simplify-js`、`uuid`），会打破零依赖约定。
2. **iframe 内注入 Annotorious 无实现路径**：`/api/proxy`（server.mjs）当前只做服务器端 fetch + HTML 文本重写（`rewriteEmbedHtml` 仅插 `<base>`），**没有 JS 注入机制**；Annotorious 必须挂在目标 DOM 元素上、在 iframe 的 window context 里初始化，父页面 JS 无法直接跨 document 操作。要走通需改 `rewriteEmbedHtml` 注入 bootstrap script + 父子 `postMessage` 协议——重大工程量，绝非"复用 embed 现成通道"。
3. **四痛点无一是"批注能力不足"**：定位批注只服务 S3 设计可视化，而 S3 在本轮四痛点里没有需求。属 YAGNI。

**本轮做法**：wireframe/image 用图上叠 SVG overlay（百分比坐标）；iframe 用 iframe **外层** SVG overlay（pin 相对 iframe 元素百分比，不进 iframe 内部）。pin 数据仍走已有的 `pin` feedback 类型（constants.mjs:5 已在枚举内）。§3.2-3.5 的 Annotorious/Recogito 统一模型作为**未来引入构建步骤后的目标态**保留，非本轮实施。

### 3.1 目标

一套数据、一个评论栏，覆盖三种锚定：**文字锚定（飞书式）**、**定位点/区域批注（原型/UI/截图）**、**整体评论（无锚点）**。桌面"左内容右评论栏"，移动端底部抽屉。

### 3.2 OSS 选型（目标态，非本轮 —— 见 §3.0）

> 以下选型是"引入构建步骤后的目标态"。**本轮用自研零依赖 SVG pin 层**（百分比坐标，wireframe/image 叠图上、iframe 叠外层 overlay），不接入下列 npm 包。

- **定位批注（截图/原型/UI 区域）**：**Annotorious v3**（`@annotorious/annotorious`）。BSD-3-Clause 可商用、纯前端、5 个轻量运行时依赖、内置 rectangle/polygon/point 绘制与 SVG 覆盖层、W3C 数据模型对齐、活跃维护（3.8.6，2025-06）。用于 `prototype` block 的 image / iframe（iframe 内注入）/ wireframe 浮层。理由：SVG 坐标计算、触摸、多形状手柄、undo/redo、W3C 序列化全部已解决，无重复造轮子必要。
- **文字锚定**：**Recogito text-annotator-js**（`@recogito/text-annotator`）。与 Annotorious 同作者、同组织、数据模型对齐、可同页并用（GitHub discussion #546 确认兼容）；BSD-3。用于 S2/S4 的正文选区评论。
- **飞书式 embed 内文字选区**：Vibe 已有实现（`blocks.mjs:122` renderEmbed + `app.mjs:298` bindEmbedIframe，选中→FAB→rail 卡片）。保留，作为 iframe 代理页面的文字锚定；Recogito 用于本地渲染的 markdown/editable 正文。
- **不选**：Hypothesis client（需配套后端、过重）；annotatorjs（停滞，reboot 多年未出正式版）；Rangy/mark.js（仅底层/仅高亮，无批注模型）。

### 3.3 统一数据模型 `annotations[]`（W3C Web Annotation 变体）

一个 block 的批注全部挂在 draft/feedback 的 `annotations[]`，用 `selector.type` 分发渲染：

```js
annotation = {
  id: 'a-<uuid>',
  blockId: 'b-…',
  role: 'comment' | 'annotation',   // Zeplin 经验：临时评论(可 resolve) vs 永久说明(常显)
  target: {
    selector: {
      // 文字锚定（Recogito / embed 选区）
      type: 'TextQuoteSelector', quote, prefix, suffix,           // 容错锚
      // 或 精确字符偏移
      // type: 'TextPositionSelector', start, end,
      // 或 定位批注（Annotorious：点 / 矩形 / 多边形）
      // type: 'FragmentSelector', value: 'xywh=percent:x,y,w,h'   // 百分比，跨分辨率稳定
      // type: 'SvgSelector', value: '<svg>…</svg>'                // 多边形
    }
  },
  bodyText: string,          // 评论正文
  done: boolean,             // resolve 状态
  author, createdAt, round,  // round 用于跨轮可见（§4）
}
```

要点：
- **百分比坐标**（`xywh=percent:…`）沿用旧仓做法，跨设备/分辨率稳定（旧仓已验证）。
- 一个 annotation 可挂多 selector（精确 + 容错），锚定丢失时降级。
- 文字与定位 **共用同一 schema、同一 `annotations[]` 数组、同一评论栏**——渲染器按 `selector.type` 分发 pin/高亮。这正是 Ink & Switch Patchwork 的"pointer 抽象"与 W3C 统一模型的落地。

### 3.4 统一评论栏（右栏）与双向联动

"左内容 · 右评论栏"下，无论文字锚定还是定位批注，评论条目**都进同一个右栏列表**，按 block → 锚点顺序排列。交互统一（Figma + Google Docs 模型）：

- 内容区点 pin / 高亮 → 右栏对应条目 active + 滚入视野。
- 右栏条目 hover/点 → 内容区高亮锚点 / 滚动到 pin。
- 文字选中 → 浮出"💬 评论"tooltip → 写入右栏（S2/S4）。
- 原型/截图区点击 → 落 pin，右栏新建输入框（S3）。
- pin 密集 → 聚合数字徽章（Figma cluster）。
- `role:'comment'` 可 resolve 隐藏；`role:'annotation'` 常显（Zeplin 分离）。

实现落点：现有 embed rail（`app.mjs:153` appendRailCard）已是"右栏卡片 + 引用 + 编辑/读态"雏形，**升级为统一评论栏组件**：数据源从 `draft[blockId].comments[]` 迁到 `draft[blockId].annotations[]`，渲染分发按 selector.type，pin 层由自研 SVG overlay 托管（目标态才换 Annotorious）。

**迁移兼容（C8，批注批次前置）**：现有格式与新 `annotations[]` 不兼容——embed 评论存 `draft[blockId].comments[]=[{id,quote,text,done}]`、普通块存 `draft[blockId].comment=string`（app.mjs:104,108），`doSubmit`（app.mjs:550-568）硬编码从 `comments[]` 提交 pin。换数据源前必须：① 在 `restoreDraftUI` 里写一次性 migration，检测旧 `comments[]`/`comment` 并转成 `annotations[]`（无对应 selector 的降级为 `role:'comment'` 无锚整体评论），否则历史草稿刷新即丢；② 同步改 `doSubmit` 遍历 `annotations[]` 产出 pin/comment feedback。此为批注批次的验收前置。

### 3.5 移动端方案

- 右评论栏 → **底部抽屉（Bottom Sheet）**，评论卡外观与桌面一致（Figma 用户研究结论）。
- 放置批注：**long-press 落 pin**（替代 click）；tap pin 打开评论卡。
  - **注意（C8）**：iOS Safari 上 long-press 会触发原生选字/弹菜单，与自定义 pin 冲突；自研 SVG overlay 的触摸不像 Annotorious 那样自带处理（Annotorious 的触摸支持只针对它托管的 `<img>`，不覆盖外层 overlay）。需专门实现 `touchstart`/`touchend` handler：`preventDefault()` + 300ms timer 区分 tap / scroll / long-press。列入批注批次验收测试项。
- 结构化场景（S1）移动端：三态按钮 + 内联 comment，天然适配窄屏；分区照旧折叠。
- 定位批注移动端：自研 overlay 上落 pin；pin 密集聚合为徽章。

---

## 4. 【重点】根治"重复内容 / 找不到新点 / 旧反馈残留"

问题三层级（更正后）：**P0 真根因=`routeBlocks` 不读 `_change`，注意力路由与 diff 是两套没对齐的系统**（审查 C1）；P0 载体缺陷=`verdict.body` 从不渲染（§5.0）；P1=已答项无追踪、无沉降区；P2=跨轮草稿/批注隔离。下面每条给确切改法与文件锚点。

### 改动 A' — 让 `_change` 参与注意力分区（P0，真根因，最高优先级）

- **真根因（审查 C1，已核对源码）**：主渲染路径是 `app.mjs:63 $zones.innerHTML = renderZones(_blocks)`，走**注意力分区**（zoneContext/A/B/C）。`routeBlocks`（attention.mjs:5-24）**通篇不看 `_change`**：`_change==='unchanged'` 的 FYI 块（无 default）照样进 `zoneContext`「AI 的思考·绝不折叠」顶在最前；unchanged 的决策块照样进 zoneA/B 顶部。原"只看变更 toggle"（diff-view.mjs + app.mjs:515-526 靠 `el.hidden`）是**和主渲染半脱节的开关**，给它加默认勾选只是打补丁，治标不治本。
- 改法（核心）：
  1. `routeBlocks` 增 `_change` 感知：`_change==='unchanged'` 的块（无论 needs/fyi）**默认降级到折叠区**，只有 `new`/`changed` 进 zoneContext/zoneA/zoneB。unchanged 的 FYI 进 zoneCFyi，unchanged 的决策块进新的"待复核折叠区"（配合改动 C 的 `_decidedInPrev` 归档）。
  2. 折叠 wrapper **只由 `renderZones` 在 zoneA/B/context 分区渲染时按 `_change` 决定是否包 `<details>`**（审查 C6）——**不改 `blockHtml`**，否则会连 zoneContext 里 unchanged 的叙述块一起折叠，违反"绝不折叠"原则（zoneContext 的 new/changed 叙述仍常显）。
  3. 原"只看变更 toggle"退化为"展开历史/全部"开关（可选保留）；`diff-view.mjs` 的 checkbox 是否默认勾选已不再是关键。
  4. 首轮特判：第 1 轮所有块都是 `new`（server.mjs:169 对空 prevBlocks 全标 new），不折叠任何东西，行为正确。
- 参照：GitHub PR "Changed since last view" 默认只展示变更。

### 改动 B — 顶部"本轮待确认 N 项（新增 M · 改动 K）"+ 跳转（P0）

- 现状：`src/render/attention-view.mjs:19-24` statusBar 只报"需你决策 X 项（Y 无预设）"，无增量分层，用户判断不了本轮"新东西多不多"。
- 改法：
  1. `src/protocol/attention.mjs` 新增导出 `roundDeltaStats(diffedBlocks)`：
     ```js
     export function roundDeltaStats(blocks = []) {
       const d = blocks.filter(b => b.needsDecision);
       return {
         totalDecision: d.length,
         newDecision: d.filter(b => b._change === 'new').length,
         changedDecision: d.filter(b => b._change === 'changed').length,
         newFyi: blocks.filter(b => !b.needsDecision && b._change === 'new').length,
       };
     }
     ```
  2. `attention-view.mjs:11` statusBar 接 delta，文案改：`本轮 N 项待你确认（新增 M · 改动 K）▸ 跳到待决策`。
  3. **首轮特判（审查 P1-1）**：第 1 轮全部块都是 `new`（server.mjs 对空 prevBlocks 全标 new），"新增 N · 改动 0"无信息量。`roundDeltaStats` 加 `round`/`isFirstRound` 判断，或 `attention-view.mjs` 检查 `round === 1` 时降级文案为"首轮 · N 项待确认"（不显示 delta）。
- 参照：VS Code Tool Confirmation Carousel 的 "3 of 12" 队列深度暴露；GitHub file-tree 注释指示器。

### 改动 C — 已决项沉降归档（P1）

- 现状：上轮已表态、本轮 `unchanged` 的 block 仍按 needsDecision 进 zoneA/B，与新内容混排（`attention.mjs:17-18`），用户重复确认感强。
- **注意（审查 C7）**：本改动是全新逻辑，非"小改"——`/api/content`（server.mjs:154-173）当前只读 prev **content** 做 diff，**完全不读 feedback**。中等偏重。
- 改法：
  1. **服务端注入 `_decidedInPrev`**：`server.mjs:154` `/api/content` 分支里，读上一轮 feedback（`readJSON(paths.feedback(session, prevRound), null)`），**先做 null guard**（审查 C5）：`if (!prevFeedback) → 跳过注入`（前轮 feedback 缺失、第 1 轮、文件被删都走此分支，不报错）。若 block.id 在上轮 items 里有对应反馈且本轮 `_change==='unchanged'`，给 diffed block 打 `_decidedInPrev = true`。
  2. **路由新规则**：`attention.mjs:routeBlocks` 增：`_decidedInPrev && _change==='unchanged'` → 强制进 `zoneCFyi`（折叠归档），无视 needsDecision。（与改动 A' 的 `_change` 分区规则合并实现。）
  3. 效果：上轮已确认且本轮没变的，本轮默认收进折叠区，不再当新问题问。
- 参照：Google Docs resolved thread 归档；ai-review-bot tombstone（已解决项存档不重复上报）。

### 改动 D — 沉降区标题语义化（P1）

- 现状：`attention-view.mjs:32-41` fyiSummary 只列"default: xxx"，看不出"这些是我上轮决过的"。
- 改法：折叠 `<summary>` 分两类计数：`已决 N 项（上轮已确认 · 本轮无变化）` 与 `AI 设默认 M 项 · 点开查看`。用 `_decidedInPrev` 区分两组。
- 参照：GitHub "Mark as Viewed" 自动折叠 + 保留 "Changed since last view" 标签。

### 改动 E — AI 已采纳回执，不重复问已决内容（P1，提前 —— 审查 C7）

> 审查 C7：本改动是"旧反馈残留感"的正面解法，是痛点①的一部分，从原 P2 提到批次 1/2。

- 现状：用户上轮批注后，本轮 AI 是否据此改了、改在哪，UI 不可见 → 用户不确定是否要再说一遍。
- 改法：`src/render/diff-view.mjs:15` changeBadge 增两种徽章：
  - `_change==='changed'` 且 block.id 在上轮 feedback 有反馈 → `↩ 已采纳`（AI 基于你的反馈改了）。
  - `_change==='unchanged'` 且上轮有反馈 → `— 维持`（AI 维持上轮内容）。
  （复用 C 注入的上轮反馈映射，服务端多带一个 `_respondedToPrev` 标记即可。）
- 参照：ai-review-bot"agent 收到自己上轮评审、避免重复上报"；Synthia"批改过的不再重复展示"。

### 跨轮草稿/批注可见（P2，配合 A-E）

- 现状：`app.mjs:20` `draftKey()` = `wb:SESSION:ROUND:fb`，新轮不加载旧轮 draft；批注跨轮消失。
- 改法：`restoreDraftUI`（`app.mjs:86`）在加载本轮 draft 后，**额外拉上一轮 feedback 的 `annotations[]` 以只读卡片渲染**（`round < currentRound` 的置灰、标"上轮"）。让"上轮在这里说过什么"始终可见（历史断层修复）。

### 改动优先级小结

| 改动 | 覆盖痛点 | 文件 | 改动量 | 优先级 |
|---|---|---|---|---|
| **0 verdict/blockHtml 渲染 body** | 痛点③载体缺失（§5 落空点） | blocks.mjs | 小 | **P0（真前置）** |
| **A' `_change` 参与分区** | 被淹没·重复感真根因 | attention.mjs, app.mjs(renderZones) | 中 | **P0（真根因）** |
| B 顶部 delta 计数 + 首轮特判 | 判断不了增量 | attention.mjs, attention-view.mjs | 小 | P0 |
| C 已决项沉降（+null guard） | 旧反馈残留、重复确认 | server.mjs, attention.mjs | 中 | P1 |
| D 沉降区语义化 | 看不出"已决过" | attention-view.mjs | 小 | P1 |
| E AI 已采纳回执 | 不知 AI 是否响应（旧反馈残留正面解） | diff-view.mjs, server.mjs | 中 | **P1（提前）** |
| 跨轮批注只读可见 | 历史断层 | app.mjs | 中 | P2（随批注批次） |

（原改动 A"toggle 默认勾选 + 首屏隐藏"降为 A' 的辅助/可选，不再单列 P0。）

---

## 5. 内容质量与颗粒度（去黑话 + 场景化宏观测试）

> 直接可嵌入 `dev-review.mjs` 与 `design-review.mjs` 的 PRD/场景/测试节写作规则。这既是"给 AI 生成内容时的写作指南"，也是模板注释。

### 5.0 【前置】先让 `block.body` 上屏（P0，审查 C2）

**否则本节全部落空。** 已核对源码：`renderVerdict`（blocks.mjs:80-90）只渲染三态按钮 + 理由 textarea，**完全不读 `block.body`**；`blockHtml`（blocks.mjs:163-176）只输出 `titleHtml + renderContent + commentEntry`，**verdict 的 body 无处显示**（`dev-review.mjs` 已给 verdict 塞 body，但用户永远看不到）。本节教 AI 把"删除后无法恢复"等关键后果写进 `body`，若 body 不上屏，用户只看到光秃秃的问句标题 + 三个按钮，痛点③解法整体落空。

改法（批次 0，一处小改）：在 `blockHtml` 的通用渲染里，于 `titleHtml(block)` 之后、`block-content` 之前，为有 `body` 的块统一渲染 `<p class="block-body">${escHtml(block.body)}</p>`（或在 `renderVerdict`/`renderChecklist` 内渲染 body）。优先在 `blockHtml` 通用层做，让所有需要后果描述的 block 类型都受益。

### 5.1 去技术黑话写作指南（用于 verdict/checklist 的 title/body）

1. **写"会发生什么"，不写"系统做什么"**（后果视角 > 系统视角）。
   - ✗ "系统弹出确认对话框，用户确认后执行删除，不可恢复"
   - ✓ "删除后无法恢复。确定要删除这条记录吗？" + 主按钮"永久删除" / 次按钮"取消"
2. **决策项按钮/选项用"动词+名词"，消灭 Yes/No/OK**。choice 的 options 写"发送支付 / 返回"，不写"确定 / 取消"。
3. **"是否可撤销"是核心信息，显式写**（不可逆操作必须点明）。
4. **正文 ≤2 句**：说清"什么情况、什么后果"，不说原因、不说实现。
5. **用问句代替命令句**（对话感）："删掉这个功能还是补需求？" > "确认删除决策"。
6. **可逆操作不必确认**，用 Undo Toast；不可逆才上确认。

映射到 block 字段：verdict/choice 的 `title` 用问句、`body` ≤2 句后果描述、`options` 用动词+名词。这条规则写进 `dev-review.mjs` 顶部注释，AI 产出 prdItems 时遵循。

### 5.2 场景化宏观测试设计指南（用于 test 节 / testScenarios）

细颗粒度的操作步骤（"点蓝色提交按钮"）有害；要写**业务行为**。三层顺序：旅程 → 功能场景 → 验收标准。

1. **用户场景节 = 旅程叙事 + 用户意图 + 期望结果**，不是操作流程罗列。
   - ✗ "进后台→点用户管理→输入用户名→点搜索→列表展示"
   - ✓ "场景：管理员要处理某用户的权限问题。他记得对方邮箱，希望 30 秒内定位并改权限，无需找技术支持。"
2. **测试场景 = BDD Given/When/Then，业务价值导向**，不含 UI 细节。
   ```gherkin
   Scenario: 管理员快速定位并修改用户权限
     Given 管理员已登录后台，知道目标用户邮箱
     When 管理员搜索该邮箱并修改权限
     Then 权限变更立即生效，目标用户下次登录受新权限约束
   ```
3. **需求确认会用 Example Mapping**（25 分钟、黄=故事/蓝=规则/绿=例子/红=问题；不写 Gherkin，红卡多=需求未成熟）。可作为"评审前"线下动作，产出直接喂进 dev-review 模板。

映射到模板：`testScenarios[].name` 用场景名、`.expect` 用 Given/When/Then 叙事；架构面 `.rationale` 用"为什么这么设计"的白话。dev-review 模板的 test 节生成 `verdict` block（场景确认）+ 可选 `code`(gherkin) 折叠详情。

### 5.3 dev-review 模板改进对照

| 节 | 当前问题 | 改进方向（写进模板注释） |
|---|---|---|
| PRD 确认项 | 技术术语 + 操作描述 | 后果描述 + 用户语言 + 可逆性标注 + 问句 title |
| 用户场景 | 操作流程罗列 | 旅程叙事 + 用户意图 + 期望结果 |
| 测试设计 | 功能点清单 | BDD Given/When/Then + 业务价值导向 |
| 颗粒度 | 条目太细太技术 | 一条 verdict = 一个用户可判断的价值点，不拆到字段级；可加轻量 lint（body 超 N 字 / 含"点击·按钮·系统"等黑话词 → 生成时告警），把"不写黑话"从建议变约束 |

---

## 6. 分批实施计划（v2 重排 —— 痛点根治先行，批注/原型后置）

> 排序原则：**四痛点根治是本轮唯一目标**（批次 0-2）；融合新增件（批次 3）随后；批注系统与原型迁移（批次 4-5）后置到有构建步骤/原型评审场景再启动。

### 批次 0（P0，半天）——修两处真根因，纯前端
- 文件：`src/render/blocks.mjs`（body 上屏）、`src/protocol/attention.mjs` + `src/render/app.mjs` 的 `renderZones`（`_change` 参与分区）
- 内容：**§5.0 让 `block.body` 上屏**（否则 §5 去黑话全落空）；**改动 A' `routeBlocks` 让 `_change` 参与分区**（unchanged 默认降级折叠，折叠 wrapper 只在 renderZones 分区做、不改 blockHtml）
- 验收：① verdict/checklist 的 body 在页面可见；② unchanged 的 FYI/决策块默认折叠、new/changed 常显；③ zoneContext 里 new/changed 叙述块不被误折叠；④ 首轮全 new 时不折叠；⑤ 现有 attention 单测全绿 + 新增 `_change` 分区单测。
- 优先级：**P0（真根因，最先做）**

### 批次 1（P0，1-2 天）——增量可见 + AI 回执
- 文件：`src/protocol/attention.mjs`（roundDeltaStats）、`src/render/attention-view.mjs`（顶部文案 + 首轮特判）、`src/server/server.mjs` + `src/render/diff-view.mjs`（改动 E 的 `_respondedToPrev` 徽章）
- 内容：改动 B（roundDeltaStats + 顶部"本轮 N 项待确认（新增 M · 改动 K）"+ 首轮特判）；改动 E（↩已采纳 / —维持 徽章，提前）
- 验收：① 顶部计数正确、首轮降级为"首轮 · N 项待确认"；② changed 且上轮有反馈显示"↩已采纳"、unchanged 且上轮有反馈显示"—维持"；③ 新增 roundDeltaStats 单测。
- 优先级：P0

### 批次 2（P1，2-3 天）——已决项沉降
- 文件：`src/server/server.mjs`（/api/content 注入 `_decidedInPrev`，含 null guard）、`src/protocol/attention.mjs`（routeBlocks 归档规则，与批次 0 的 `_change` 分区合并）、`src/render/attention-view.mjs`（fyiSummary 语义化）
- 内容：改动 C（含前轮 feedback null guard）、改动 D
- 验收：① 上轮已决且本轮 unchanged 的块进折叠归档区；② 折叠标题区分"已决 N 项"与"AI 设默认 M 项"；③ 服务端注入有单测，**fixture 含两轮正常场景 + "前轮 feedback 缺失"场景**（验证 null guard 不报错）。
- 优先级：P1

### 批次 3（P1-P2，3-4 天）——新增件 + 内容质量（零依赖）
- 文件：`src/protocol/constants.mjs`（BLOCK_TYPES 加 `prototype`/`checklist`）、`src/protocol/schema.mjs`（**blockFingerprint 扩展新字段，见 §1.4 C**）、`src/render/blocks.mjs`（renderPrototype/renderChecklist，**自研零依赖 SVG pin**）、`templates/dev-review.mjs`（archAssertions/archAlternatives/testCases + 去黑话注释）、新增 `templates/design-review.mjs`
- 内容：checklist block（三态）；prototype block（wireframe/image/iframe 均用自研 SVG pin，**不接 Annotorious**）；blockFingerprint 扩展；§5 写作规范注释
- 验收：① completeness 四组能以 checklist 三态渲染并提交（每 item 一条 `value:'itemId:label'` feedback）；② prototype 能过目 + 落 SVG pin + 提交 pin 反馈；③ **改 prototype.src / checklist.items 后 diff 正确标 changed**（验证 fingerprint 扩展）；④ 模板产出符合去黑话规范（人工抽检）。
- 优先级：P1（checklist + fingerprint + 去黑话）/ P2（prototype）
- **prototype 存疑项**：wireframe/iframe 原型评审四痛点无需求，若无原型场景可整块延后（审查 2）。

### 批次 4（后置，非本轮）——统一批注系统（需先引入构建步骤）
- **前提**：引入 vite/esbuild 打包步骤（把 Annotorious/Recogito 打成 vendor bundle，同 mermaid.min.js），否则不启动。
- 文件：构建配置、`src/render/blocks.mjs`、`src/render/app.mjs`（统一评论栏、annotations[] 数据源 + **comments[]→annotations[] migration**）、`src/protocol/schema.mjs`（annotations 校验）
- 内容：§3 统一 `annotations[]` + 统一评论栏 + Annotorious/Recogito 接入 + 双向联动 + 跨轮批注只读可见
- 验收：① 文字锚定与定位批注进同一右栏、双向联动；② 百分比坐标跨分辨率稳定；③ 上一轮批注只读卡片可见；④ **移动端 long-press 与 iOS 原生手势不冲突**（专门 touchstart/touchend handler）；⑤ **历史 comments[] 草稿迁移不丢**。
- 优先级：后置（与四痛点无关，出现原型/UI 评审需求再启动）

### 批次 5（收尾）——迁移与弃用旧仓
- 文件：`scripts/import-prd-project.mjs`（一次性转换）
- 内容：§1.5 全量导入 demo.js；四场景（S1-S4）浏览器实测；达成 §1.7 判据后归档 PRD Review Studio
- 验收：§1.7 五条判据全部满足；旧仓打 tag 归档、README 指向 Vibe。
- 优先级：P2（依赖批次 0-3；定位批注部分依赖批次 4）

---

## 7. 明确不做（本轮范围外，备查）

以下来自审查 3 的缺口清单，判为 YAGNI/超范围——四痛点无一涉及。真出现对应场景再评估，不占本轮工期：

- **场景**：S5「多版本设计对比」、S6「数据看板验收」、API/契约评审场景。→ 现有四场景够用，模板可后续扩。
- **批注**：嵌套回复 threads（`replies[]`）、视频/时间戳批注、IndexedDB 离线缓存、pin 聚合徽章的复杂交互。→ 目标态再议。
- **块间关联**：`linkedBlockId`（PRD 条目↔架构断言双向追踪）、testScenario vs completeness 冲突检测、checklist 组间依赖 `dependencies[]`。→ 复杂度高、收益不明。
- **迁移运维**：旧仓 readonly banner、双写一致性守护、analytics 使用埋点、模板 `version` 字段 + backward compat。→ §1.7 判据 + 一次性导入脚本已够；旧仓归档即停止维护，无需长期双轨。
- **prototype iframe 沙箱/CSP 强化**：自研 SVG overlay 不进 iframe 内部，沿用 embed 现有 `/api/proxy` 策略即可；第三方脚本风险在目标态接入真实交互时再评估。

---

## 来源 URL 汇编

批注 OSS 选型：
- Annotorious npm (v3.8.6)：https://www.npmjs.com/package/@annotorious/annotorious
- Annotorious 官方文档：https://annotorious.dev
- Annotorious Data Model（W3C 对齐）：https://annotorious.dev/guides/data-model
- Annotorious Getting Started（iframe 说明）：https://annotorious.dev/getting-started
- annotorious/annotorious GitHub：https://github.com/annotorious/annotorious
- Remove Svelte Dependency PR #582：https://github.com/annotorious/annotorious/pull/582
- @annotorious/plugin-tools npm：https://npmjs.com/package/@annotorious/plugin-tools
- recogito/text-annotator-js GitHub：https://github.com/recogito/text-annotator-js
- annotatorjs（reboot in progress，不选）：https://annotatorjs.com
- Rangy v1.3.2 Release：https://github.com/timdown/rangy/releases/tag/1.3.2
- mark.js 官网：https://markjs.io
- advanced-mark.js GitHub：https://github.com/angezid/advanced-mark.js
- hypothesis/client GitHub（BSD-2，不选）：https://github.com/hypothesis/client
- W3C Web Annotation Data Model：https://www.w3.org/TR/annotation-model
- Text Fragments (MDN)：https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments

批注交互设计：
- Figma — Add comments：https://help.figma.com/hc/en-us/articles/360041068574-Add-comments-to-files
- Figma — View and manage comments：https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments
- Figma mobile app guide：https://help.figma.com/hc/en-us/articles/1500007537281-Guide-to-the-Figma-mobile-app
- Figma Mirror iOS UX case study：https://www.gwendolynelder.com/figma-mirror-concept-ios
- Zeplin — Flows and Annotations：https://blog.zeplin.io/product-news/introducing-flows-and-annotations-a-new-way-to-communicate-design-intention/
- Zeplin API — Screen Note：https://docs.zeplin.dev/reference/screen_note
- Markup.io webinar：https://www.youtube.com/watch?v=ojt5Mhhj9dk
- launchthedamnthing — Markup review：https://launchthedamnthing.com/blog/website-feedback-markup
- Tom Critchlow — UX of web-annotations：https://tomcritchlow.com/2019/02/12/annotations
- Ink & Switch — Universal comments (Patchwork)：https://www.inkandswitch.com/patchwork/notebook/2024-version-control/11/
- Marvel Developers — Commenting API：https://marvelapp.com/developers/documentation/tutorials/commenting
- arturnbull/designer-notes GitHub：https://github.com/arturnbull/designer-notes
- CAADRIA 2023 — Annotation on Interactive Design Data：https://doi.org/10.52842/conf.caadria.2023.2.401

重复内容 / 注意力路由：
- GitHub "Changes since last view" Discussion #7645：https://github.com/orgs/community/discussions/7645
- GitHub Improved Files Changed Experience (2025-06)：https://github.blog/changelog/2025-06-26-improved-pull-request-files-changed-experience-now-in-public-preview
- VS Code Tool Confirmation Carousel — AgentPatterns.ai：https://agentpatterns.ai/agent-design/tool-confirmation-carousel/
- vscode Issue #307689 — batched confirmations carousel：https://github.com/microsoft/vscode/issues/307689
- joeblackwaslike/ai-review-bot PR#21（增量审查 + tombstones）：https://github.com/joeblackwaslike/ai-review-bot/pull/21
- Synthia UIST25（反馈气泡选择）：https://chaozhang.design/assets/publications/synthia_uist25/synthia_uist25.pdf
- UX Patterns Guide — Notification Center：https://uxpatternsguide.com/patterns/notification-center/
- Crewship Inbox — unread→read→resolved：https://docs.crewship.ai/guides/inbox
- Lynox Unified Inbox — three-zone triage：https://docs.lynox.ai/features/unified-inbox/
- OPENSPHERE src-link（反偏见全量重审）：https://github.com/OPENSPHERE-Inc/src-link/commit/30b06366dbb5f0b001f613899f40f1e41cbacbb1

内容质量 / 场景化测试：
- NN/g — Confirmation Dialogs：https://www.nngroup.com/articles/confirmation-dialog
- Beth Aitman — How to write a confirmation dialog：https://bethaitman.com/posts/ui-writing/confirmation
- UX Movement — 5 Rules for Button Labels：https://uxmovement.com/buttons/5-rules-for-choosing-the-right-words-on-button-labels
- SitePoint — Human-friendly Microcopy：https://www.sitepoint.com/writing-clear-human-friendly-microcopy
- parallelhq — UX Writing Principles：https://www.parallelhq.com/blog/ux-writing-best-practices
- Cucumber — Introducing Example Mapping：https://cucumber.io/blog/bdd/example-mapping-introduction
- Cucumber — Your first Example Mapping session：https://cucumber.io/blog/bdd/your-first-example-mapping-session
- Automation Panda — Writing Good Gherkin：https://automationpanda.com/2017/01/30/bdd-101-writing-good-gherkin
- testquality — Gherkin Best Practices：https://testquality.com/10-essential-gherkin-best-practices-for-effective-bdd-testing
- AltexSoft — Acceptance Criteria Best Practices：https://www.altexsoft.com/blog/acceptance-criteria-purposes-formats-and-best-practices
