STATUS: APPROVED

> 范围调整（用户 2026-06-30 绿灯）：**不做 MVP，按 docs/PRD.md 全量实现 + 完整自动化测试，全自动闭环开发**。
> 含 FR-1~FR-8（注意力路由 FR-7、轮次 diff FR-8、容错恢复 FR-6）。流程：完整 UX 设计(docs/DESIGN.md) → UX 自审(场景测试) → 闭环实现 → 自动化测试全绿。用户暂不可确认，遇决策按 PRD + 最佳实践自决并记录。

# 计划：通用人机交互层 — 全量实现（autonomous）

## 1. 目标
让"我把思考渲染成图文 HTML（按内容类型选可视化）→ 你在网页上评论/选择/编辑 → 提交后我在同一回合续跑"这条回路，**在当前这次对话里就能真实用起来**。
本 MVP 只验证三层中的「**内容协议 + 网页载体**」；桥内核用最简的"同回合 poll"，不引入 daemon。

## 2. 架构（本 MVP 落地的部分）
```
我(Claude in VSCode) ──写── content.md(单一信息源) + content.json(渲染数据)
                                      │
                          复用 prd-studio 零依赖 server + 前端引擎
                                      │ 渲染
                              你在浏览器看图文/选择/评论
                                      │ 提交 POST
                              server 落盘 feedback.json
                                      │
我 ── bash 轮询到 feedback.json（超时兜底）── 读取 → 续跑
```
- 触发模型：**同回合 poll**。不需要 daemon、不需要 claude-exec（那是 phase 2 异步版要用的）。
- 网页载体 = 复用 [prd-review-studio](/Users/michael/projects/组件模块/prd-review-studio/) 的 `server.js` + 数据驱动前端，剥掉 PRD 专用的 6 个面。

## 3. MVP 范围
**做：**
- 内容协议 v0：`blocks[]` + `feedback[]`
  - block.type：`markdown` / `mermaid`(架构图&流程图) / `choice`(单选&多选) / `freetext`
  - feedback.type：`select` / `comment`
- 通用渲染器：markdown→HTML、mermaid→SVG、choice→可点选控件、freetext→输入框；每块可挂评论
- server：复用 prd-studio `server.js`（`POST /api/feedback` 落盘 + 静态托管）
- 主循环 poll 脚本：bash 等 `feedback.json`，带超时兜底
- 双轨落盘：`content.md`（人读/信息源）+ `content.json`（渲染）+ `feedback.json`（你的回流）

**不做（YAGNI，留给后续）：**
- 飞书载体（已有黑盒可用，phase 2 再统一）
- 异步 daemon / `claude-exec` 驱动（phase 2 异步唤醒版）
- 思维导图 / 原型截图 / SVG 动画等高级 block（先 4 种，后续按需加）
- 多人协作、鉴权、公网部署

## 4. 步骤清单
- [ ] 1. 建项目骨架：把 prd-studio 的 `server.js` + 前端引擎复制进本工作台，剥离 PRD 6 面专用逻辑
- [ ] 2. 定义内容协议 v0（schema 文档 + 一个示例 `content.json`）
- [ ] 3. 实现通用渲染器（4 种 block + 评论层）
- [ ] 4. 接 feedback 收集 + POST 落盘（复用 prd-studio）
- [ ] 5. 写主循环 poll 脚本（同回合等待 + 超时）
- [ ] 6. 端到端 dogfood：我用它向你呈现"下一步设计决策"，你网页提交，我续跑

## 5. 影响 / 新建文件（均在 vibecoding 工作台目录下）
- `server.js`（复用改造）
- `public/index.html` / `public/app.js` / `public/app.css`（复用改造 studio.*）
- `protocol/schema.md` + `protocol/example.content.json`
- `loop.sh`（poll 脚本）
- `workspace/`（运行时落盘 content/feedback）

## 6. 测试计划
- 单元：协议解析；渲染器对 4 种 block 输出正确 DOM
- 端到端：起 server → 浏览器打开 → 提交 → `feedback.json` 落盘 → poll 读到
- 验收：本次对话真实跑通一轮

## 7. 风险与取舍
- ~~§3.7：MVP 是交互式、有人在场，非无人值守 bot~~（该风险项已作废，2026-08-30 王佳梁订正：订阅额度驱动的无人值守自动化被允许）
- poll 阻塞我的回合：超时兜底，避免卡死
- prd-studio 改造量：步骤 1 先快速评估剥离 6 面的成本，过大则只借 server.js、前端重写
