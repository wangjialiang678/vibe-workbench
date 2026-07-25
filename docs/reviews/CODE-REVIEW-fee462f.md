# CODE REVIEW — `fee462f`

审查对象：`git show fee462f`  
主题：`block.assignee` 按卡可见性；参与者只应看到公共块和指派给自己的块。  
审查方式：只读代码追踪、HTTP 临时夹具验证、现有测试执行；未修改源文件，未执行 Git 写操作。

## 总体结论

**不能合进 `main`。** 当前实现的普通 happy path 是服务端过滤，但至少有两条可直接吐出私有 block 内容的阻断路径：

1. 参与者在跨轮次“原本可见、后来被指派给别人”时，可从 `/api/content` 的 `removed` 字段拿到完整旧 block。
2. 参与者可从 `/api/assets` 枚举会话资产，再从 `/assets/...` 下载隐藏 block 引用的文件。
3. 参与者可回答通过 stream 关联到隐藏 block 的 quick-decision ask，绕过 block 级投票限制。

另有参与者可调用 `/api/retry` 改变整轮状态，以及 feedback/stream 引用过滤不完整的问题。

## 发现

### 1. 【阻断】跨轮次可见性收紧会把旧 block 完整放进 `removed`

**问题：** `/api/content` 先按当前身份分别过滤 current/previous blocks，再用 `removedBlocks()` 计算删除项；当 block 从“对该参与者可见”变成“对该参与者不可见”时，旧 block 被误判为普通删除项并原样返回。

**触发场景：**

1. 第 1 轮写入 `{ id: "secret", body: "previously visible secret", assignee: null }`。
2. 第 2 轮复用 `id: "secret"`，改为 `{ body: "new private body", assignee: "bob" }`。
3. 持有 Alice 合法 token 的请求：

   ```http
   GET /api/content?session=assignee-transition&round=2
   X-Workbench-Token: alice-token
   ```

4. 返回的 `blocks` 为空，但 `removed` 含有第 1 轮完整 block，包括 `body` 和其他字段。已用临时工作区实际复现：HTTP 200，`removed[0].body === "previously visible secret"`。

**位置：** `src/server/server.mjs:1432-1435`、`src/server/server.mjs:1455`；底层 `src/protocol/diff.mjs:28-32`；同时 `src/protocol/schema.mjs:27-40` 的 `blockFingerprint()` 未包含 `assignee`。

**建议改法：** 对参与者返回 `removed` 前，以当前轮原始 block ID/可见性重新校验：当前轮仍存在但当前身份不可见的 ID 不得进入 `removed`；只有对当前身份确实可见、且当前轮不存在的旧 block 才能返回。另将 `assignee` 纳入 fingerprint，并补 public→private、alice→bob、private→alice 三种跨轮回归测试。

### 2. 【阻断】会话资产没有按 block 可见性授权，可枚举并下载隐藏 block 的文件

**问题：** `/api/assets` 递归列出整个 session 的资产，`/assets/<session>/<path>` 只校验参与者 token 和路径穿越，不检查该文件是否只被隐藏 block 引用；参与者因此可以绕过 `/api/content` 的 block 过滤读取原型图片、iframe HTML、PDF 等完整内容。

**触发场景：**

1. 某个 `assignee: "bob"` 的 prototype/embed block 引用 `/assets/asset-session/private/secret.html`。
2. Alice 请求：

   ```http
   GET /api/assets?session=asset-session
   X-Workbench-Token: alice-token
   ```

   返回 200，列出 `private/secret.html`。
3. Alice 再请求：

   ```http
   GET /assets/asset-session/private/secret.html?token=alice-token
   ```

   返回 200 和文件正文。已用临时工作区实际复现。

**位置：** `src/server/server.mjs:1160-1167`、`src/server/server.mjs:1616-1647`；前端还会把全量清单放入参与者可见的文档区，见 `src/render/app.mjs:853-875`。

**建议改法：** 参与者的资产清单只返回当前身份可见 block 可达的资产；静态资产下载也必须在服务端按 session/round/block 引用做同一授权检查，不能只靠页面不渲染。需要定义同一资产被公共块和私有块共同引用时的公共可见规则，并为 prototype/embed/image/PDF 各补直读测试。

### 3. 【应修】feedback 过滤只覆盖 `items` 的已知 block，`unanswered`、未知 ID 和缺失内容时会失败开放

**问题：** `filterFeedbackForIdentity()` 只过滤 `feedback.items` 中出现在当前 content 的 block ID；`unanswered` 不过滤，未知 block ID 也被保留，且 content 缺失/损坏时 `visibility` 为 `null`，整个 feedback 原样返回。这会泄漏私有 block ID，并让未知/历史 block 进入参与者的 feedback 视图和冲突检测。

**触发场景：**

1. 当前轮有 `bob-only`，owner feedback 带 `unanswered: ["bob-only"]`；Alice 请求：

   ```http
   GET /api/feedback?session=feedback-edge&round=1
   X-Workbench-Token: alice-token
   ```

2. `feedback.items` 中的 `bob-only` 会被过滤，但返回的 `feedback.unanswered` 仍包含 `bob-only`。已实际复现。
3. Alice 还可以直接提交一个当前内容不存在的 ID：

   ```http
   POST /api/feedback
   X-Workbench-Token: alice-token
   Content-Type: application/json

   {"session":"feedback-edge","round":1,
    "items":[{"blockId":"not-a-block","type":"select","value":"forged"}]}
   ```

   当前返回 200 并落盘；后续 `GET /api/feedback` 不会移除该 item。若该轮 content 缺失/损坏，参与者可直接收到未过滤的全部 feedback。

**位置：** `src/server/server.mjs:358-382`、`src/server/server.mjs:484-505`、`src/server/server.mjs:1472-1500`；输入校验 `src/protocol/schema.mjs:152-164` 不验证 block ID 是否属于当前轮。

**建议改法：** 对参与者采用默认拒绝：`items` 和 `unanswered` 只允许当前 content 中且对该身份可见的 block ID；未知 ID 在写入侧直接 400/403，缺失或无效 content 时不要向参与者返回 feedback。若要兼容旧反馈，只在 owner 视图保留未知 ID，不能以兼容为由向参与者失败开放。冲突检测只接收已授权的 block 集合。

### 4. 【应修】参与者可以调用 `/api/retry`，重置任意轮次并间接影响整轮处理

**问题：** `/api/retry` 没有 owner/participant 权限判断；合法 participant token 即可删除 `ack/error`、把状态改为 `submitted`，触发 worker 重新处理整轮。它不直接带 `blockId`，但能间接影响包含不可见 block 的整轮反馈和生成流程。

**触发场景：**

```http
POST /api/retry?session=feedback-edge&round=1
X-Workbench-Token: alice-token
```

当前返回 200 `{ "ok": true }`，并执行 `removeFile(paths.ack(...))`、`removeFile(paths.error(...))` 和 `writeStatus(..., { state: "submitted" })`；已实际复现。

**位置：** `src/server/server.mjs:1599-1610`；前端入口 `src/render/app.mjs:2089-2093` 也未承担安全职责。

**建议改法：** 在 handler 服务端强制 owner-only；无口令本地模式仍允许无 token 请求按原 owner 兼容路径执行，但不能因为带着 participant token 就获得 owner 权限。补 participant token 调用 retry 的 403 测试，并校验 session/round 使用精确路径。

### 5. 【应修】stream API 不过滤 `refs.blockId`，会泄漏隐藏 block 引用，且 text 没有 block 级边界

**问题：** `/api/messages` 将整个 stream entry 原样返回；stream 协议允许 `refs.blockId`，`/api/stream-events` 也接受 owner 提供的 refs，但没有按参与者过滤。当前内置 round/feedback receipt 只写 `refs.round`，但合法 API 调用可以把隐藏 block ID 放进 stream，未来 AI/integration 若把 block 内容写进 text 也会直接对所有参与者可见。

**触发场景：**

1. 管理员写入：

   ```http
   POST /api/stream-events
   X-Workbench-Token: owner-token
   Content-Type: application/json

   {"session":"stream-leak","kind":"message",
    "text":"private block reference",
    "refs":{"round":1,"blockId":"bob-only"}}
   ```

2. Alice 请求：

   ```http
   GET /api/messages?session=stream-leak
   X-Workbench-Token: alice-token
   ```

   返回 entry 中的 `refs.blockId: "bob-only"`；已实际复现。参与者写 `/api/stream-events` 本身会被拒绝，这里是读侧过滤遗漏。

**位置：** `src/server/server.mjs:997-1013`、`src/server/server.mjs:1077-1107`；`src/stream.mjs:33-45` 明确允许 `refs.blockId`。

**建议改法：** 为 stream 引用定义 block 可见性过滤：参与者只收到当前可见 block 的 refs，隐藏/未知 block ref 删除或整条事件不返回；需要携带私有 block 正文的事件必须改成可按身份裁剪的结构，不能依赖前端隐藏。

### 6. 【阻断】participant 可回答与隐藏 block 关联的 stream ask

**问题：** `/api/messages` 的 answer 分支只校验 `answerTo` 对应的 ask 存在且选项合法，没有校验该 ask 的 `refs.blockId` 是否对当前 participant 可见；同时 ask 本身也会从未过滤的 stream 返回。参与者因此可以直接提交对隐藏 block 的 quick-decision 投票。

**触发场景：**

1. 管理员通过 `/api/stream-events` 写入 `kind: "ask"`，并设置 `refs: { round: 1, blockId: "bob-only" }`，ask ID 为 `hidden-ask`。
2. Alice 直接请求：

   ```http
   POST /api/messages
   X-Workbench-Token: alice-token
   Content-Type: application/json

   {"session":"ask-leak","answerTo":"hidden-ask","answerValue":"a"}
   ```

3. 当前返回 200，并落入一条 `author.role: "participant"` 的 answer。已用临时 HTTP 夹具实际复现。

**位置：** `src/server/server.mjs:1022-1048`、`src/server/server.mjs:1077-1107`；`src/stream.mjs:192-224`。

**建议改法：** 读取 stream 时过滤带隐藏/未知 `refs.blockId` 的 ask；写 answer 时重新读取 ask，按其 `refs.round` 加载对应 content，并要求 block 对当前身份可见。没有可验证关联的 ask 应默认按公开 session ask 处理或禁止 block 级 answer，不能仅凭 ask ID 放行。

### 7. 【建议】上一轮隐藏反馈会泄漏 `_respondedToPrev` 状态

**问题：** `/api/content` 用未过滤的上一轮 `feedback.items` 生成 `_respondedToPrev`；当 block 上一轮只对 Bob 可见、下一轮改指派给 Alice 时，Alice 能知道上一轮该 block 曾有反馈，虽然她上一轮看不到该 block。

**触发场景：** 第 1 轮 block `secret` 的 `assignee` 为 `bob` 且 feedback 含 `blockId: "secret"`；第 2 轮同 ID 改为 `assignee: "alice"`。Alice 请求第 2 轮 `/api/content`，当前可见 block 会被加上 `_respondedToPrev: true`。

**位置：** `src/server/server.mjs:1440-1449`。

**建议改法：** 生成上一轮响应标记前，先以当前身份过滤上一轮 content 和 feedback；只有该身份在上一轮也可见的 block 才允许注入 `_respondedToPrev`/`_decidedInPrev`。

## 按审查维度逐项结论

### 1. 所有 block 内容出口

- `/api/content`：当前 block 列表、上一轮 diff 的 current/prev 输入均在服务端过滤；**发现阻断**：`removed` 在可见性收紧时泄漏旧 block 全文。
- `/api/rounds`：只有 `POST`，没有 GET 读路径；参与者创建轮次在 `src/server/server.mjs:1263-1267` 被 403。**无发现**。
- `/api/feedback` GET：服务端过滤已知 block 的 `items`；**发现**：`unanswered`、未知 ID 和缺失 content 失败开放，见发现 3。
- `/api/session-context`：`src/server/server.mjs:1190-1205` 仅允许配置了 owner token 的 owner worker；**无发现**。
- `/api/messages`：返回完整 stream entries；**发现**：`refs.blockId` 未过滤，见发现 5。当前内置 receipt 的 refs 只有 round，但协议/API 允许 blockId。
- `/api/messages` 的 answer 分支：**发现阻断**，知道隐藏 ask ID 的 participant 可提交 `answerTo/answerValue`，见发现 6。
- `/api/stream-events`：participant 写入在 `src/server/server.mjs:1077-1081` 被拒；owner 可写 refs，读侧未裁剪，见发现 5。
- render 页面：HTML/JS 是静态入口，block 内容来自 `/api/content`，不是前端先拿全量再隐藏；**服务端过滤成立**，但不能抵消 `removed` 和资产下载漏洞。
- `/api/assets` 与 `/assets/...`：**发现阻断**，全量资产清单和文件下载未按 block 授权，见发现 2。
- `/api/documents`：返回 session 级文档，不是 block-specific 读路径；现有语义允许已认证参与者读取。**就本次 block 可见性而言无发现**。
- `/api/status`：只返回状态和 error artifact，不返回 content blocks；**无直接 block 内容发现**。
- export/download：没有发现直接下载 `content.md`、`feedback.md`、`response.md` 或任意 round 文件的 HTTP 路由；但 `/assets` 实际构成了隐藏 block 引用文件的下载出口，见发现 2。浏览器 `downloadFallback()` 只下载参与者本地当前 payload，不是隐藏内容出口。
- 直接读 round 目录：HTTP 静态根是 `src/`，没有 workspace round 目录直出；服务端内部读取仅在上述 API 组装响应时发生。`/api/content`、`/api/feedback` 的内部读取已逐项审查，分别见发现 1、3。

### 2. 写入侧绕过

- participant 直接 `POST /api/feedback` 到当前 content 中存在且不可见的 `blockId`：在 `src/server/server.mjs:1472-1500` 服务端 403，发生在任何 participant feedback 文件和状态写入之前；新增测试确实通过真实 HTTP 请求验证了这一点。
- 混合可见/不可见 items：当前实现先收集全部 forbidden IDs，再统一返回，正常情况下不会部分落盘；但缺少回归测试。
- annotation/pin/move/checklist/verdict/select：都最终进入 `/api/feedback` 的 `items`，因此当前可见 block ID 检查会覆盖它们；**无另一路直接绕过发现**。
- `/api/messages`：participant 可以发 session 级消息，但 handler 不保留客户端 `refs/blockId`，不能借此直接写 block feedback；**无 block-specific 绕过发现**。
- `/api/messages` 的 answer：**发现阻断**，它不是普通 session 消息，当前会回答任意已存在的 ask，见发现 6。
- `/api/stream-events`：participant 403；**无写入绕过发现**。
- `/api/rounds`：participant 403；**无写入绕过发现**。
- `/api/attachments`：participant 可上传新资产，但使用唯一文件名，不会覆盖既有隐藏资产；本身不构成对隐藏 block 的投票/修改绕过。资产读侧仍有发现 2。
- `/api/retry`：participant 可写整轮状态，见发现 4。

### 3. 身份解析、伪造和吊销

- assignee 比对使用 `resolveRequestIdentity()` 依据 token 查到的 `participant.id`，不是请求 body、query 中的 participant ID，也不是客户端提交的 `submittedBy`；feedback 写入时服务端在 `src/server/server.mjs:1509-1512` 覆盖 `submittedBy`。**无身份伪造发现**。
- API token 可来自 `X-Workbench-Token` 或 query `token`；query 不能把 participant 身份升级为 owner。header 优先只是 token 选择顺序，不是可伪造身份字段。
- `findParticipantByToken()` 每次请求重新读取名册，`revokeParticipant()` 后下一请求立即不再解析为 participant；现有 e2e 也覆盖了吊销后拒绝。**无发现**。
- `WORKBENCH_TOKEN` 未设置时，无 token 请求按 owner 兼容行为放行；owner 身份对所有 assignee 可见。**无发现**。这符合本地无口令模式的原行为；带有效 participant token 的请求仍按 participant 过滤，不应把“无口令”误当成 participant 权限。

### 4. 服务端还是前端隐藏

`/api/content` 与 `/api/feedback` 的主过滤都在服务端，渲染层只消费已过滤响应，**不是单纯前端隐藏**。但 `/assets` 是服务端没有做 block 级授权的真实绕过，见发现 2；`removed` 也是服务端响应直接泄漏，见发现 1。

### 5. 只读互见与冲突检测

- 普通场景下，甲可见的 shared block 上，乙的意见仍会在 `/api/feedback` 返回并显示；新增测试真实验证通过。
- 对当前 content 中已知且不可见的 block，`items` 会在 `detectFeedbackConflicts()` 前被过滤，因此正常冲突不会把该 block 算进去。
- **发现**：未知 block ID 被保留，可能进入 `detectFeedbackConflicts()`，产生已删除/非法 block 的误报，也会暴露 block 引用；`unanswered` 另有泄漏，见发现 3。
- **发现**：上一轮 feedback 未按上一轮身份过滤，`_respondedToPrev` 会泄漏历史反馈是否存在，见发现 7。

### 6. 向后兼容

无 `assignee`、`assignee: null`、`assignee: ""` 的 block 会被视为公共块；现有测试和 `isBlockVisibleTo()` 均支持，**无发现**。

但 `blockFingerprint()` 未包含 `assignee`，会使“内容相同、责任人改变”的块被标成 `unchanged`；当责任人改变导致参与者失去访问权时，还与发现 1 的 `removed` 泄漏叠加。该项需随发现 1 一并修复。

### 7. owner 与本地无口令

`isBlockVisibleTo()` 对非 participant（owner、AI、默认 owner）直接返回 true；本地 `expectedToken` 未设置且无 token 时 `resolveRequestIdentity()` 回退 owner。**无发现**。

### 8. 测试质量

新增 `tests/unit/block-visibility.test.mjs` 不是纯复述实现：它启动真实 HTTP server，验证 owner/participant 的 `/api/content`、真实 `/api/feedback` 提交、跨参与者意见和冲突结果。

特别问题“participant 直接请求不可见块并断言被拒”**有覆盖**：`tests/unit/block-visibility.test.mjs:132-150` 的 `fetch(POST /api/feedback)` 使用 Alice token 直接提交 `bob-only`，并断言响应失败、无 participant feedback 文件、状态未改变。

但测试仍有以下缺口：

- `tests/unit/block-visibility.test.mjs:142` 接受 `[400, 403]`，没有锁定这是服务端授权拒绝（当前实现实际为 403）。
- 没有跨轮 public/alice → bob 的 `/api/content` `removed` 泄漏回归测试。
- 没有 participant 访问 `/api/assets` 清单和 `/assets/...` 文件的测试。
- 没有 `/api/messages` 中 `refs.blockId` 的过滤测试。
- 没有隐藏 ask 的 `answerTo/answerValue` 直接 HTTP 投票拒绝测试。
- 没有 `unanswered`、未知 block ID、缺失 content 时的 feedback 读写和冲突测试。
- 没有 participant 调用 `/api/retry` 应被拒的测试。
- 没有跨轮 `_respondedToPrev` 不能泄漏上一轮隐藏反馈的测试。
- 没有验证 `/api/rounds` 通过真实写入链路拒绝非法 `assignee`，也没有 revoked token 对 `/api/content`/`/api/feedback` 立即失效的专项测试。

## 验证记录

- `node --test tests/unit/block-visibility.test.mjs`：8/8 通过。
- `node --test tests/e2e/server.test.mjs tests/e2e/session-stream.test.mjs`：77/77 通过。
- `npm test`：538/538 通过。
- 额外临时工作区 HTTP 夹具：复现 `removed` 泄漏、资产枚举/直读、feedback `unanswered` 泄漏、未知 feedback ID 接受、participant retry 200、stream `refs.blockId` 泄漏、隐藏 ask 被 participant answer 200。

测试全绿不能改变总体结论：关键攻击路径尚未进入测试矩阵，且两条真实服务端路径已经可以直接读到不属于参与者的 block 内容。
