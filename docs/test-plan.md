# 测试计划（Scenario-First）

## P0 存活
- [ ] ESM 全部可加载（无语法/导入错误）  `node --check` 各文件 / import 冒烟
- [ ] 协议单测通过  `node --test tests/unit/protocol.test.mjs`
- [ ] server 起得来并响应 /api/health  e2e
- [ ] 全量测试通过  `node --test`

## P1 核心功能
- [backend] content API 注入 diff、feedback 落盘+状态机、status 联合判定、retry 重置
- [backend] rounds 远程写入（鉴权/2 MiB/lint/409）、feedback GET 轮询、事件 webhook
- [backend] 参与者 magic-link 身份、owner-only 管理 API、逐人反馈/owner 优先合并/select 分歧、首份兼容唤醒
- [backend] 异步唤醒 listener 对账 + ack 幂等 + error 不拖垮 + 心跳异步
- [frontend] blockHtml 各类型、md→HTML、注意力分区、diff 徽章+只看变更、状态徽章+重试
- [templates] think-discuss / dev-review 产出合协议、决策块元数据正确
- [CLI] workbench render 写入 + status=rendered；--help
- [CLI] WORKBENCH_REMOTE_URL 下 present/wait 只读写云端；未设置时本地路径零回归
- [CLI] participant add/list/revoke 本地与远程一致，list 不泄漏 token
- [frontend] 逐块只读意见/分歧角标、会话列表、meta.docsUrl 设计资产入口

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
| D5 个人链接 | tests/unit/participants.test.mjs、tests/e2e/server.test.mjs | 名册原子写/脱敏/吊销、参与者 token、管理 API 鉴权 | [backend] |
| D6 逐人反馈 | tests/e2e/server.test.mjs、tests/unit/render.test.mjs | 独立落盘、兼容桥、owner 优先、select 分歧、只读转义渲染 | [backend]/[frontend] |
| participant CLI | tests/e2e/bin.test.mjs、tests/e2e/present.test.mjs | 本地/远程 add/list/revoke | [CLI] |
| 导航/meta | tests/unit/protocol.test.mjs、tests/e2e/present.test.mjs | meta.docsUrl 校验、会话列表与设计资产数据流 | [frontend] |
| FR-4/6 回路 | tests/e2e/loop.test.mjs | 对账/幂等/error/心跳 | [scenario] |
| CLI | tests/e2e/bin.test.mjs | render/help | [CLI] |
