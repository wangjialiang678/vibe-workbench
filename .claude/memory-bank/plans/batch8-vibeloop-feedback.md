STATUS: APPROVED（用户已批范围：整个 iteration-brief + 富渲染最后一公里；病例集当 fixture）

# 批次 8：user-vibeloop 实战反馈全量落地（"看得懂 + 看得见"）

来源：`docs/iteration-brief-2026-07-13.md`（Michael 实战 4 轮）+ `docs/feedback-examples-2026-07-13.md`（8 病例，当 fixture/验收样例）。
根因共识：工作台目前渲染的内容**太单薄**——① 决策没背景/利弊 → 看不懂（伪决策）；② 富渲染能力有但内容不用 → 看不见。

## 步骤

- [ ] **1 · P0 修复：embed 代理不转发 POST**（`server.mjs:219` 只认 GET；实证 bug）
  - `/api/proxy` 支持 POST/PUT/DELETE：透传 method、body、Content-Type（form-urlencoded + json），响应完整回传。
  - 被代理页内相对 URL（form action / fetch）落回代理通道（延伸现有 GET 的 URL 改写）。
  - 安全边界不放松（仍走现有 http/https + 超时限制）。
  - 测试：起本地 echo 服务 → 经代理 POST 表单 → 断言字段无损到达。

- [ ] **2 · P1 决策块结构化（创始人加权·最高 UX 优先级）** ← 病例 1/3/4/8
  - schema：choice/verdict 增可选 `background` / `why` / `recommendReason`；options[] 增 `pros[]` / `cons[]`。
  - 渲染固定四段：**背景 → 为什么需要你定 → 选项（各带利弊）→ 推荐及理由**；缺字段不渲染（向后兼容）。
  - 作者侧 lint（`present` 时 warn 不阻断）：`needsDecision:true` 缺 `background`、或选项缺 pros/cons → 警告。
  - authoring 文档写入"大白话原则"（术语首次出现必须一句话解释）+ 内容基准（病例 8 的四种有效写法：一句话本质类比 / 后果与可回退性 / 为什么停下来等你 / 四维自评）。

- [ ] **3 · P1 会话级常驻"给 AI 留言"入口** ← 病例 6
  - 渲染页常驻自由输入区（提交栏上方）；协议 `feedback.sessionComment`（string，可空）。
  - schema + 文档同步；老消费者不受影响（向后兼容）。

- [ ] **4 · P1 live embed 标识** ← 病例 7（视觉层解决，不靠文案）
  - `embed` / `prototype(iframe)` 块加可选 `live: true` → 渲染"⚡ 实时系统"角标 + 醒目边框态，与静态样例视觉区分。

- [ ] **5 · P2 受众分层** ← 病例 2
  - 块级可选 `audience: "decider" | "tech"`；`tech` 默认折叠进"技术细节"区（不占决策者注意力）。

- [ ] **6 · P2 确认场景低摩擦控件** ← 病例 5（行为数据：editable 连续两轮无人应答）
  - `editable` 增"✓ 保持原样即确认"一键（不必编辑）。
  - `unanswered` 语义细分：区分"没看/未操作" vs "看了不改（确认原值）"。

- [ ] **7 · 富渲染最后一公里**（让"看得见"真正可用）
  - `scripts/import-prd-project.mjs` 补 `convertUI`：`ui.screens[]` → `prototype(mode:'iframe', src)`（此前完全没写）。
  - prototype iframe 加**手机壳**呈现（360×740 黑边圆角，对齐 prd-studio 观感）。
  - import 时给块打 `section`（→ tab 分面：需求/架构/交互设计/UI 设计/测试/风险）。
  - 验证：把 **recorder-app 真实数据**导进 Vibe，肉眼看到「6 tab + mermaid 架构图 + 10 个高保真手机屏」。

- [ ] **8 · P3 术语一致性**：authoring 文档加术语表约定入口。

- [ ] **9 · 回归 + 交付**：`npm test` 全绿；真实浏览器 dogfood（Playwright）；更新 DESIGN/dev-log/feedback-log（标"→ 已转化"）/SKILL.md；提交。

## 向后兼容硬约束
所有新字段均**可选**；schema 放行旧内容；缺字段渲染行为不变。老 session 不受影响。

## 非目标
真实浏览器 E2E 自动化套件、embed SSRF allowlist 加固、暗色对比度全面复核（留作后续批次）。
