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
- [backend] JSONL 会话流、实名消息、AI 自动回执、owner-only stream-events（message/progress/receipt）、受保护附件上传
- [backend] 云端文档库分类存储、管理员发布/更新、列表/单篇读取、校验与更新回执
- [backend] 异步唤醒 listener 对账 + ack 幂等 + error 不拖垮 + 心跳异步
- [backend] 常驻 worker 管理员心跳 + 90 秒在线判定、本机 webhook 即时唤醒、60 秒轮询兜底、同轮重新提交
- [frontend] blockHtml 各类型、md→HTML、注意力分区、diff 徽章+只看变更、状态徽章+重试
- [frontend] 桌面会话流可拖分栏、决策/文档切换、手机对话/决策/文档三标签与未读角标
- [frontend] 消息分侧、receipt/progress、增量轮询、附件 Markdown、最新轮决策芯片、pin 浮层边缘翻转
- [frontend] 文档按类目分组、Markdown 单篇阅读（含图片）、历史轮次移入决策区；pin 使用容器坐标且布局变化不脱锚
- [templates] think-discuss / dev-review 产出合协议、决策块元数据正确
- [CLI] workbench render 写入 + status=rendered；--help
- [CLI] workbench doc-publish 本地/WORKBENCH_REMOTE_URL 远程发布与更新
- [CLI] WORKBENCH_REMOTE_URL 下 present/wait 只读写云端；未设置时本地路径零回归
- [CLI] participant add/list/revoke 本地与远程一致，list 不泄漏 token
- [CLI] wait --events 本地/远程消息唤醒；stream-migrate 历史留言幂等
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
| 会话流数据层 | tests/unit/stream.test.mjs | append/read since/最近100/精确路径/迁移幂等 | [backend] |
| 会话流与附件 API | tests/e2e/session-stream.test.mjs | 消息实名/长度/回执/管理员事件/webhook/附件类型大小清洗鉴权 | [backend] |
| 会话流前端 G2 | tests/unit/render.test.mjs、Playwright 冒烟 | 分栏/三区 DOM、消息分侧、系统事件、决策芯片、附件 Markdown、手机未读、文档资产、pin 锚定 | [frontend] |
| 云端文档库 G3 | tests/e2e/documents.test.mjs、tests/unit/documents-view.test.mjs、tests/unit/render.test.mjs | API 鉴权/校验/更新语义、CLI 本地与远程发布、类目分组/单篇 Markdown、历史轮次移位、pin 容器坐标 | [backend]/[CLI]/[frontend] |
| 事件化 CLI | tests/e2e/stream-cli.test.mjs | wait --events 本地/远程唤醒、默认兼容、stream-migrate | [CLI] |
| D5 个人链接 | tests/unit/participants.test.mjs、tests/e2e/server.test.mjs | 名册原子写/脱敏/吊销、参与者 token、管理 API 鉴权 | [backend] |
| D6 逐人反馈 | tests/e2e/server.test.mjs、tests/unit/render.test.mjs | 独立落盘、兼容桥、owner 优先、select 分歧、只读转义渲染 | [backend]/[frontend] |
| participant CLI | tests/e2e/bin.test.mjs、tests/e2e/present.test.mjs | 本地/远程 add/list/revoke | [CLI] |
| 导航/meta | tests/unit/protocol.test.mjs、tests/e2e/present.test.mjs | meta.docsUrl 校验、会话列表与设计资产数据流 | [frontend] |
| FR-4/6 回路 | tests/e2e/loop.test.mjs | 对账/幂等/error/心跳 | [scenario] |
| 云端常驻 worker | tests/e2e/server.test.mjs、tests/unit/resident-worker.test.mjs、tests/unit/status-bar.test.mjs | 心跳鉴权/过期、在线横幅、推送唤醒、兜底轮询、同轮二次提交 | [backend]/[frontend] |
| CLI | tests/e2e/bin.test.mjs | render/help | [CLI] |
