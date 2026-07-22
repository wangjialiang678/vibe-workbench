# present 决策块可读性硬阻断实施计划

> **执行方式：** 当前会话内联执行。用户明确要求不要 Git commit，因此本计划不包含提交步骤。

**目标：** 仅在 `workbench present` 提交新内容时，对 `needsDecision:true` 块执行决策完整性硬校验，并提供显式逃生开关。

**架构：** 在现有浏览器安全的 lint 模块中新增纯函数，负责收集和格式化逐块缺失项；`cmdPresent` 在启动服务和调用 `cmdRender` 前使用它。`cmdRender`、schema、serve、render 和历史 workspace 读取路径保持原行为。

**技术栈：** Node.js 20+、ESM、`node:test`、零外部依赖。

---

### 任务 1：用 E2E 测试固定 present 边界

**文件：**
- 修改：`tests/e2e/present.test.mjs`

- [x] 增加真实 CLI helper，向 `present <session> - --port <port>` 的 stdin 写入 JSON，并收集退出码、stdout、stderr。
- [x] 增加“缺 background 的 needsDecision choice 被拒”测试，断言退出码非 0、错误含块 id/背景、workspace 未写入。
- [x] 增加“`--allow-incomplete-decisions` 放行”测试，断言 JSON 含 `lintBypassed:true` 且 stderr 仍有 lint warning。
- [x] 增加“四段齐全正常通过”测试。
- [x] 增加“`needsDecision:false` 简陋块不受影响”测试。
- [x] 运行 `node --test tests/e2e/present.test.mjs`，确认新测试因新行为尚未实现而失败。

### 任务 2：用单元测试固定完整性判定边界

**文件：**
- 修改：`tests/unit/lint.test.mjs`

- [x] 为新接口 `findIncompleteDecisions(content)` 增加测试：空白 background、空白 why、只缺 pros、只缺 cons、缺 recommendReason 分别进入同一块的缺失字段清单。
- [x] 断言 `needsDecision:false` 即使字段简陋也不产生完整性问题。
- [x] 运行 `node --test tests/unit/lint.test.mjs`，确认因导出尚不存在而失败。

### 任务 3：实现纯函数与 present enforcement

**文件：**
- 修改：`src/protocol/lint.mjs`
- 修改：`bin/workbench.mjs`

- [x] 在 lint 模块中实现非空字符串判断、逐 option 利弊检查、逐块缺失项收集和中文错误格式化。
- [x] 让现有结构化 warning 使用相同的严格判定；其余三条 lint 继续只 warning。
- [x] 在 `cmdPresent` 中仅当未绕过时执行硬校验；失败在任何 workspace 写入和 server 启动前抛错。
- [x] 解析 `--allow-incomplete-decisions`，传入 `cmdPresent`，显式使用时在结果中加入 `lintBypassed:true`。
- [x] 更新 CLI help 和 present 用法。
- [x] 运行 `node --test tests/unit/lint.test.mjs tests/e2e/present.test.mjs`，确认定向测试通过。

### 任务 4：同步行为文档并全量验证

**文件：**
- 修改：`README.md`
- 修改：`docs/authoring-guide.md`
- 修改：`docs/DESIGN.md`

- [x] 说明 present 的四段完整性规则已硬阻断，render/serve/历史轮次不受影响。
- [x] 记录逃生开关及 `lintBypassed:true`。
- [x] 运行 `npm test`，按测试失败补齐仅与 present 新行为直接相关的 fixture，不放宽校验。
- [x] 检查 `git diff --check`、`git diff --stat` 和最终 diff。
- [x] 按用户最新指令不再调用子代理，由主线程独立审查逻辑正确性、边界与风格；无阻塞问题。
