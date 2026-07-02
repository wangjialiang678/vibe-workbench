# 交付报告 — PRD 工作台并入 Vibe + 重复内容根治（2026-07-02）

> 依据设计文档 [research/2026-07-02-fusion-and-annotation-design.md](research/2026-07-02-fusion-and-annotation-design.md)（多代理调研+对抗式审查产出）。全程自主实现 + 浏览器逐项实测。

## 本轮范围与状态

| 批次 | 内容 | 状态 |
|---|---|---|
| 0 | `block.body` 上屏 + `_change` 参与注意力分区（unchanged 沉降折叠、new/changed 常显） | ✅ 提交+浏览器验 |
| 1 | 顶部「本轮 N 项待你确认（新增 M·改动 K）」+ 首轮特判 + AI「↩已采纳/—维持」回执徽章 | ✅ |
| 2 | 服务端注入 `_decidedInPrev`(含 null guard) + 已决项沉降归档 + 沉降区语义化 | ✅ |
| 3 | `checklist` block（三态自查）+ `prototype` block（**自研零依赖 SVG 定位批注**）+ blockFingerprint 扩展 + dev-review 去黑话/架构断言备选 + design-review 模板 | ✅ |
| 5 | `import-prd-project.mjs`（demo.js 六面 → 19 个 Vibe block）+ 旧仓弃用标注（**未删任何文件**） | ✅ |
| 4 | 统一 `annotations[]` + Annotorious/Recogito | ⏸ **按设计后置**：需先引入构建步骤（打破当前零依赖/无打包），且与本轮四痛点无关。自研 SVG pin 已覆盖定位批注需求 |

## 根治的痛点（你反复提的）

- **每轮大量重复、找不到新点**：真根因是 `routeBlocks` 从不读 `_change`（注意力路由与 diff 两套没对齐）→ 已让 `_change`/`_decidedInPrev` 参与分区，unchanged/已决默认沉降折叠，只有 new/changed 常显。
- **旧反馈残留**：AI 据上轮反馈改了会打「↩已采纳」、维持打「—维持」；上轮已决且本轮未变的收进「已决 N 项（上轮已确认·本轮无变化）」折叠区，不再重复问。
- **条目太细/太技术**：dev-review 模板加了去黑话+场景化写作规范（后果视角、问句 title、动词+名词选项、BDD 场景、≤2 句 body）；`block.body` 现已上屏（此前 verdict 的 body 根本不渲染，去黑话会落空）。
- **测试太细**：测试节走 Given/When/Then 业务场景，不写 UI 操作步骤。

## 浏览器实测（我逐项验过，非仅单测）

- 批次0-2：two-round 场景 → body 可见；unchanged+已决进「已决 1 项」折叠；b-sync（改+上轮答过）显「↩已采纳」；顶部「本轮 2 项待你确认（新增1·改动1）」。
- 批次3：checklist 三项×三态（已覆盖/明确不做/待定）点选+持久化；prototype iframe 经代理加载真实页 + SVG overlay 落 pin + 内联评论 + 保存持久化。
- 批次5：demo.js → 19 block 全渲染无错（verdict×9/diagram/choice/code×2/checklist×4/prototype×2），wireframe 控件坐标归位。

## 验证中发现并修复的问题

1. **顶部计数虚高**：「N 项待确认」原用 totalDecision（含已沉降的）→ 改为"新增+改动"。
2. **wireframe 控件飞出画布**：导入脚本把 px 坐标当比例 ×100 → 按 340×720 归一化为 0-1。
3.（非代码）运行中的旧 server 进程未加载新注入逻辑 → 重启即好（改后端逻辑需重启 server）。

## 工作流为何中途停

实现工作流跑完批次 0-3（已提交）+ 启动批次5，但**后台工作流进程被外部终止**（journal：5 started/4 result、无 error 事件），review 未启动。最可能是主会话并发 `pkill`/`git`/`node --test` 干扰了后台同仓提交。已手动收尾（批次5提交 + review 的自动化核对由我完成）。

## 遗留给你

- §1.7 弃用旧仓最后一条判据「≥2 轮真实评审」需你实际走一遍确认后，旧仓才归档。
- 批次4（统一批注 + Annotorious）：若将来要在设计稿上做更强的框选/多形状标注，再引入构建步骤启动。

测试：**220 pass / 0 fail**，零运行时依赖。
