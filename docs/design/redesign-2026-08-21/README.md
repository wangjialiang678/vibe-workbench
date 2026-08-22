# 视觉重做 · 2026-08-21

起因：创始人反馈「工作台看文字比较吃力」「不要跟随系统的颜色，黑底看着不舒服」「字体有点扁」，
要求重做成 **简洁、美观、白底、专业**，并先出 3–5 个方案供选。

本轮**不加任何功能**，只重做视觉层：颜色、字号、行高、间距、边框、圆角。

---

## 一、"字体扁 / 读着吃力" 的实测原因

在本地把线上同一份页面原样跑起来（Chrome DevTools 读 computed style + canvas
`actualBoundingBox` 量真实字体度量），四条，全部可复现：

| # | 现象 | 实测值 | 后果 |
|---|---|---|---|
| 1 | 字体栈里没有任何中文字体 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | 中文全靠浏览器兜底。本机兜到 PingFang SC，换台机器可能兜到 Heiti SC / STHeiti —— 那两个字面明显更宽更扁 |
| 2 | 正文 14px / 行高 1.5 | `font-size:14px; line-height:21px` | 中文方块字在 1.5 行高下挤成一堵墙；且正文列不限宽，1440px 屏上一行 90+ 字，回行时找不到行头 |
| 3 | 未开灰度抗锯齿 | `-webkit-font-smoothing: auto` | macOS 次像素渲染把笔画糊粗一圈，中文小字尤甚 —— 「扁、糊」最直接来源 |
| 4 | 标题写 `font-weight: 700 / 800` | PingFang SC 只到 Semibold(600) | canvas 实测 600 与 700 的 bounding box **完全一致**：标题根本没变粗，层级被压平 |

> 度量方法留档：`c.font = "700 100px 'PingFang SC'"` 与 `"600 100px …"` 对 `measureText('确认事项')`
> 返回同一组 `actualBoundingBox*`，证明浏览器没有为 CJK 合成假粗体，而是直接落回 Semibold。

### 统一修法（五个方案共用 `variants/_common.css`）

- 字体栈显式点名 `"PingFang SC"` / `"Hiragino Sans GB"` / `"Microsoft YaHei"` / `"Noto Sans SC"`，不再靠兜底
- 正文 `15.5px / line-height 1.78`，`letter-spacing .006em`
- 开 `-webkit-font-smoothing: antialiased` + `-moz-osx-font-smoothing: grayscale`
- 全站字重封顶 600，层级改用「字号 + 颜色 + 留白」拉开
- 正文列限宽（原来是满宽）；具体值见 §五「正文列宽的两次调整」
- Markdown 段落与标题之间补出节奏（原来段间距为 0，读起来是一堵墙）
- 表格去掉重网格，只留发丝底线

### 暗色模式

按创始人要求**删除** `@media (prefers-color-scheme: dark)` 跟随系统的整套暗色变量，
固定亮色。`:root` 上写 `color-scheme: light only`，避免浏览器给表单控件套暗色。

> ⚠️ `tests/unit/css-vars.test.mjs` 里有一条断言 `css.includes('prefers-color-scheme: dark')`，
> 落地实现时必须同步改这条测试（改为断言「不存在暗色媒体查询」+「亮色变量齐全」）。

---

## 二、五个候选方案

`variants/` 下每个方案是一层叠在 `app.css` 之上的皮肤 CSS，只改设计层，不动结构。

| 方案 | 文件 | 气质 | 关键手法 |
|---|---|---|---|
| A 白纸 | `a-paper.css` | 像读一份排好版的文件 | 零卡片零阴影零灰画布；发丝线分段；下划线式页签；必答项只用一枚小红点 |
| B 工作台 | `b-console.css` | Linear 那类专业工具 | 1px 发丝边 + 6px 小圆角卡片、零阴影；方角标签页签选中转黑底；小标题用等宽字 |
| C 文件 | `c-editorial.css` | 正式发函 | 宋体衬线标题 + 黑体正文；条款式编号；近乎零色彩 |
| D 紧凑 | `d-compact.css` | 快速填完 | 「背景 / 为什么」压成左右两栏小字灰块；一个条目连选项一屏看完 |
| E 卡片 | `e-card.css` | 成熟 SaaS | 白卡浮在浅灰画布，12px 圆角 + 极轻投影；选项做成可选卡片 |

### 样张怎么生成的

不手搓静态页 —— 直接抓真实渲染结果，保证 1:1：

1. 起一份本地 server，用一份**真实评审会话**的 content 渲染
2. 浏览器里 `document.documentElement.outerHTML` POST 到本地落盘
3. 剥掉全部 `<script>`（样张是静态的），补一段十几行的页签切换
4. 每个方案挂 `_common.css` + 自己那份皮肤 CSS，输出到 `src/render/_lab/<id>.html`

> **样张产物不入库**：它们是客户真实评审内容的 DOM 快照，本仓库推 GitHub，
> 已在 `.gitignore` 加 `src/render/_lab/`。需要重现时按上面四步重跑即可。

---

## 三、落地时要一起处理的两件事（已在 §四 拍板）

1. **左侧对话栏占 33% 宽（最宽 480px）且经常是空的** —— 五个样张里先统一收窄到 240–360px，
   最终是「收窄 / 默认收起成竖条 / 并入右侧抽屉」哪一种，待拍板。
2. **共用 `app.css` 的到底有几端** —— 决策卡上写的是「工作台 / 客户评审门户 / 演示说明页」三端，
   **这条不准**：演示说明页（`demo.ai-opc.studio/guide/`）是一份自带 `<style>` 的独立静态页，
   不引 `app.css`。真正跟着变的是两端 —— 本机工作台 + 东京机的客户评审门户
   （`review.ai-opc.studio`，部署目录 `~/apps/sirui-review-workbench/`）。
   范围比当时说的更小，结论不变。

---

## 四、决策记录

创始人 2026-08-21 在工作台 `wb-redesign` 会话第 1 轮提交（原始反馈：`workspace/wb-redesign/round-1/feedback.json`）：

| 议题 | 选择 | 原话/批注 |
|---|---|---|
| 走哪个方向 | **C 文件** | 「但是上面那行导航（请贵司确认）样式参考 B，选中的可以用黑色底，这样更明显」 |
| 左侧对话栏 | **默认收起成竖条** | — |
| 三端范围 | **一起换** | — |

即：**C 文件为底 + 页签取 B 的方角黑底样式**。

### 落地清单（全部已完成）

- `src/render/app.css`
  - `:root` 令牌整套重写；删除 `@media (prefers-color-scheme: dark)`；加 `color-scheme: light only`
  - 新增 `--font-sans` / `--font-serif` / `--font-mono`、`--color-bg-subtle`、`--color-border-strong`
  - `body` 排版四修（中文字体栈 / 15.5px / 1.78 / 灰度抗锯齿）+ 全站字重封顶 600 + Markdown 节奏
  - 区块改条款式：无卡片、`border-bottom` 用 `--color-border-strong`（分割线要看得见）、上下留白 34/38
  - **问题序号**：`.decision-panel` 起 counter，区 A/B 的块递增，序号渲染在 `.block-title::before`；区 A 用红色。
    hidden 的 facet 不渲染 → 不计数，所以每个分面各自从 01 数起
  - 页签取方案 B：方角 5px 小标签、选中黑底白字、角标灰底（must 仍红底白字）
  - 区色条、彩色徽章、实心推荐底全部改成描边/中性
  - 画布变纯白后，27 处原本靠 `--color-bg` 做浅底的地方改指 `--color-bg-subtle`（否则全部隐形）
  - `.session-comment` 的 `margin` 简写改 `auto` —— 简写会冲掉 `.decision-panel > *` 的居中
  - 正文列宽收进 `--content-max` 令牌（见 §五）
- `src/render/blocks.mjs` — 改动徽章从独占一行改为内嵌标题行末尾（`titleHtml(block, badge)`）
- `src/render/index.html` — 新增收起态竖条 `#stream-rail` 与 `#stream-collapse` 按钮
- `src/render/app.mjs` — 收起/展开逻辑、`localStorage` 记忆（默认收起）、收起态新消息红点
- `tests/unit/css-vars.test.mjs` — 「必须有暗色媒体查询」反转为「不许有」，另加令牌完整性与中文字体栈两条

**测试：589/589 通过**（原 587，净增 2 条）。

### 踩到的坑

- **收起态网格列数**：面板与分隔线是 `display:none`，不参与 grid 放置。收起态若仍写三列，正文会落进中间那条 0 宽的分隔线列 → 整个内容区宽度变 0，页面一片空白。收起态必须写两列。
- **纯白画布让浅底全部隐形**：`--color-bg` 从 `#f9f9f9` 变 `#ffffff` 后，所有 `background: var(--color-bg)` 的次级表面（输入框、hover、代码块、表格隔行）与 `--color-surface` 同色，等于没有。必须引入独立的 `--color-bg-subtle`。
- **`margin` 简写会冲掉居中**：`.decision-panel > *` 给了 `margin-left/right: auto`，任何子元素自己写 `margin: X 0 Y` 都会把它冲掉、跑到左边去。


---

## 五、正文列宽的两次调整

**第一版 700px 定窄了。** 当时按「纯中文正文一行 32–40 字最舒服」取值，
但这个页面的实际内容大部分不是纯正文 —— 表格、利弊两栏、嵌入原型、mermaid 图，
这些都吃宽度，700px 下被挤得很难看，宽屏上还剩大片空白。
创始人 2026-08-22 反馈「目前宽度太窄了，最好加宽一些」。

**第二版改成跟着窗口放大、带上下限的一个令牌：**

```css
--content-max: min(clamp(720px, 72vw, 1180px), 100%);
```

| 视口 | 正文列（实测） |
|---|---|
| 790px（刚过移动断点） | 718px（被 `100%` 兜住，不溢出） |
| 1150px | 828px |
| 1440px | 1037px |
| ≥1640px | 1180px（封顶） |

四段各有各的作用：

- `720px` 下限 —— 再窄表格和两栏利弊就散架
- `72vw` —— 窗口越大列越宽，宽屏不再浪费
- `1180px` 上限 —— 再宽中文一行超过 75 字，回行时眼睛找不到行头
- 外层 `min(…, 100%)` —— 窗口比下限还窄时（790px 一带）兜住，防止横向溢出

**要整体调宽/调窄只改这一个值。** `.decision-panel > *`、`.documents-panel > *`、
`.session-comment` 三处都引它，改一处三处一起变。

---

## 六、视觉与结构解耦：`render/theme.css`（2026-08-22）

创始人问：「所有和视觉相关的，包括宽度、字体大小，这些在项目里是不是都不在代码里？是和代码解耦的对吗？」

**当时的诚实答案是：不是，只做了一半。** 颜色、字体栈、圆角、版心是 `:root` 令牌，
但**字号有 143 处硬编码在 `app.css`**（13px 出现 41 次、12px 31 次、14px 24 次……），
散在 2700 行里，而且视觉数值和布局结构混在同一个文件。每提一次「字大一点」都要进去翻。

### 现在的分工

| 文件 | 装什么 | 什么时候改 |
|---|---|---|
| `src/render/theme.css`（~120 行） | **全部视觉旋钮**：颜色、字体栈、字号阶梯、行高、字距、间距、圆角、版心、字重上限 | 调外观 |
| `src/render/app.css`（~2760 行） | 布局与组件结构，数值一律 `var()` 引用 | 加/改组件 |

`theme.css` 在 `index.html` 里排在 `app.css` 之前；`server.mjs` 的 `ASSET_VERSION_FILES`
已加入它，改了会照常触发页面自动刷新。

### 三个最常用的旋钮

```css
--ui-scale: 1;      /* 整体字号缩放。嫌小就 1.05 / 1.1，嫌大就 0.95 —— 下面所有字号都乘它 */
--content-max: min(clamp(720px, 72vw, 1180px), 100%);   /* 版心 */
--fs-tab: calc(15px * var(--ui-scale));                 /* 中间那条分面导航条 */
```

字号阶梯 `--fs-3xs`(10) → `--fs-3xl`(25) 共 10 档，全部写成 `calc(Npx * var(--ui-scale))`。
另有三个组件专用别名：`--fs-tab` / `--fs-block-title` / `--fs-zone-title`。

**守卫**：`tests/unit/css-vars.test.mjs` 新增一条，`app.css` 里再出现硬编码
`font-size: Npx` 就直接测试挂掉，防止一点点漏回去。

### 顺带处理的两件事

**① 分面导航条加大**（创始人：「中间这个导航条的字体可以稍微大一些，这部分比较容易被忽略，还不够醒目」）
13px/5px×11px → 15px/8px×15px，边框改 `--color-border-strong`，文字从 `#4c525b` 提到正文黑，
角标同步 10.5→12.5px。页签高度 28px → 39px。6 个页签实测总宽 621px，导航条 1037px，不溢出；
页签多时导航条本身 `overflow-x: auto` 可横向滚。

**② 抗锯齿改成按屏幕密度分开 —— 上一版我把它弄反了**

第一版无条件写了 `-webkit-font-smoothing: antialiased`，理由是「macOS 次像素渲染把中文笔画糊粗」。
这话只在 2 倍屏上成立。创始人截图是 3302×1356（接近 2.44:1，像 3440×1440 带鱼屏，多半 **1 倍屏**），
在 1 倍屏上灰度抗锯齿反而把笔画**削细削淡**，中文笔画多，一细就糊 —— 观感正是「扁」。
也就是说这条「修复」在他机器上是帮倒忙的（我只在自己的 Retina 屏上验证过）。

改成：

```css
@media (min-resolution: 2dppx) {
  body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
}
```

2 倍屏保持清爽，1 倍屏回到系统默认的次像素渲染（笔画更实）。两种屏都自适应，不需要知道用户用哪种。
同时正文基准 15.5px → 16px、块标题 20 → 21px，全站字号统一上浮约 0.5–1px。

**教训**：字体渲染类的修复必须问「在什么屏上验证的」。同一行 CSS 在 1x 和 2x 上的效果可以是相反的。
