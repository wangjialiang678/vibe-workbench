# 测试计划（Scenario-First）

## P0 存活
- [ ] ESM 全部可加载（无语法/导入错误）  `node --check` 各文件 / import 冒烟
- [ ] 协议单测通过  `node --test tests/unit/protocol.test.mjs`
- [ ] server 起得来并响应 /api/health  e2e
- [ ] 全量测试通过  `node --test`

## P1 核心功能
- [backend] content API 注入 diff、feedback 落盘+状态机、status 联合判定、retry 重置
- [backend] rounds 远程写入（鉴权/2 MiB/lint/409）、feedback GET 轮询、事件 webhook
- [backend] 异步唤醒 listener 对账 + ack 幂等 + error 不拖垮 + 心跳异步
- [frontend] blockHtml 各类型、md→HTML、注意力分区、diff 徽章+只看变更、状态徽章+重试
- [templates] think-discuss / dev-review 产出合协议、决策块元数据正确
- [CLI] workbench render 写入 + status=rendered；--help
- [CLI] WORKBENCH_REMOTE_URL 下 present/wait 只读写云端；未设置时本地路径零回归

## P1-E2E 场景（[scenario]）
- S1 think-discuss 一轮往返（mock driver）
- S5 容错：崩溃(无ack)→重启对账补处理；error→retry；心跳过期→offline；claimed+心跳鲜→processing(不误判)

## 可追溯矩阵
| 场景/需求 | 测试文件 | 用例 | 类型 |
|---|---|---|---|
| FR-1/5/7/8 协议 | tests/unit/protocol.test.mjs | schema/diff/attention/status | [feature] |
| FR-2 渲染 | tests/unit/render.test.mjs | blockHtml/md/diff-view | [feature] |
| FR-3 模板 | tests/unit/templates.test.mjs | think-discuss/dev-review | [feature] |
| FR-3/8 API | tests/e2e/server.test.mjs | content/feedback/status/retry | [backend] |
| 远程会话服务 | tests/e2e/server.test.mjs | rounds 写入/冲突/限流/lint、feedback 轮询、webhook | [backend] |
| 远程 CLI | tests/e2e/present.test.mjs | 远程 present/wait、token URL、错误中文化 | [CLI] |
| FR-4/6 回路 | tests/e2e/loop.test.mjs | 对账/幂等/error/心跳 | [scenario] |
| CLI | tests/e2e/bin.test.mjs | render/help | [CLI] |
