# 对抗性安全复审：`3b42a25`

审查对象：`3b42a25e01d03d427987c3d87b53a2a272e530f6`（当前 HEAD）

审查立场：把修复和新增测试都当作不可信，主动寻找同类攻击的变体。审查期间未修改源文件，未对审查仓库执行 Git 写操作；HTTP 夹具和临时 workspace 均在 `/tmp` 下。审查开始时工作树干净。

## 总体结论

注意：第 6 条的直接隐藏 ask 请求已被拒绝，但跨进程内容改写竞态仍可在检查后写入 answer，因此不能把第 6 条算作彻底修复。

**不能合进 `main`。** 原 7 条中，1、3、4、6、7 的普通 HTTP 主路径已挡住；2 和 5 仍有可复现的同类泄漏。除此之外，资产授权还存在跨轮次陈旧授权、内部 symlink 绕过和无界全量扫描，资产路由对畸形百分号路径还会直接让 server 进程退出。

最重要的两条仍可直接拿到不属于参与者的内容：

1. 一个带隐藏 `refs.blockId` 的 stream 普通 message 会被参与者看到，虽然 `blockId` 字段被删了，但 message 的正文原样返回。
2. 资产引用提取不是“默认拒绝”的纯安全边界：外部 URL 中只要出现 `/assets/<当前 session>/<path>` 子串，就会把本地同路径资产误判为可见；历史公共路径被复用并改写为私有内容时也仍可读。

## 原 7 条逐条结论

### 1. `removed` 泄漏上一轮旧 block

结论：**已彻底修复（在当前正常 HTTP/JSON 输入模型下）。**

位置：`src/server/server.mjs:1555-1567`、`src/protocol/schema.mjs:27-58`。

当前实现先分别按身份裁剪 current/previous blocks，再对 `removed` 过滤当前原始 block ID；`assignee` 也已进入 fingerprint。这样 public/alice → bob 的同 ID block 不会被当成普通 removed，bob → alice 则对 Alice 作为 new 出现，不带上一轮 `_prev`。

实际 HTTP 探针：

```http
GET /api/content?session=transition-probe&round=2
X-Workbench-Token: alice-token
```

夹具中第 1 轮为公共 `OLD SECRET PUBLIC`，第 2 轮同 ID 改为 Bob 私有 `NEW SECRET BOB`。实际响应为 HTTP 200、`blocks: []`、`removed: []`、`sanity: {suspect:false,news:0,removed:0,total:0}`，响应 JSON 不含旧秘密。

变体也跑了 Alice → Bob、Bob → Alice；Bob 读取后得到同 ID `_change: "changed"`，Alice 在 Bob → Alice 时得到 `_change: "new"`，没有旧私有正文。

已检查的其他出口：`_prev` 只来自当前身份同时可见的 previous block；`diffSanity` 只返回计数，不携带 block 字段；上一轮反馈标记另见第 7 条。没有发现该条原漏洞的可用变体。

### 2. 资产清单和直读绕过 block 可见性

结论：**只修了报告给出的“全量清单 + 直接下载隐藏路径”路径，资产授权仍可被变体绕过。**

修复位置：`src/server/server.mjs:289-381`、`src/server/server.mjs:1759-1813`。

已确认修好的部分：参与者的默认允许集合是空集合而不是公共放行；不存在可见引用的 hidden asset 返回 403，`/api/assets` 不列出。正常的同轮 public/private 混合引用使用 Set 去重，公共块引用的共享资产返回 200，私有块单独引用的资产返回 403。

仍可用的变体如下。

#### 2-A：外部 URL 子串误授权本地私有资产（High）

位置：`src/server/server.mjs:305-319`。

触发条件：可见 public block 的任意字符串包含类似 `https://cdn.example/assets/<session>/private/external-collision.txt`。正则不是在解析 URL，而是在整段字符串中寻找 `/assets/` 子串，因此会把外部站点的路径当成本地 `/assets/<session>/...` 引用。只要 workspace 中存在同路径的本地私有文件，参与者就能读到它。

实际请求序列：

```http
# 临时夹具中预置：public block body 含
# https://cdn.example/assets/asset-variants/private/external-collision.txt
# 本地文件：workspace/asset-variants/assets/private/external-collision.txt

GET /api/assets?session=asset-variants
X-Workbench-Token: alice-token

GET /assets/asset-variants/private/external-collision.txt?token=alice-token
```

实际观测：第一个请求 HTTP 200，清单含 `private/external-collision.txt`；第二个请求 HTTP 200，正文为 `SECRET-externalCollision`。这个文件没有被任何 Alice 可见的本地 block 引用，只有外部 URL 子串。

建议：先用 URL 解析，再只接受 origin/path 明确属于本服务且 path 精确匹配当前 session 的 `/assets/` 路径；不要用跨任意文本的正则作为授权依据。未知/外部 URL 应保持不授权。

#### 2-B：历史公共引用对后续私有重写仍然授权（High，取决于资产是否可被更新）

位置：`src/server/server.mjs:331-345`。`visibleAssetPathsForIdentity()` 扫描 session 的**所有轮次**，而资产 URL 没有 round/version；它只保存“曾经被某个可见 block 引用过”的路径。

实际请求序列：

```http
# 第 1 轮 public block 引用 /assets/asset-history-reuse/ui/same.html
GET /assets/asset-history-reuse/ui/same.html?token=alice-token
# 观测：200，正文 PUBLIC-V1

# 之后把同一路径文件改写为 SECRET-V2，且第 2 轮同路径只出现在 Bob block
GET /api/content?session=asset-history-reuse&round=2
X-Workbench-Token: alice-token
# 观测：200，blocks: []

GET /api/assets?session=asset-history-reuse
X-Workbench-Token: alice-token
# 观测：200，仍列出 ui/same.html

GET /assets/asset-history-reuse/ui/same.html?token=alice-token
# 观测：200，正文 SECRET-V2-WRITTEN-AFTER-REASSIGN
```

如果资产文件是不可变、唯一命名的，这条路径不会形成新泄漏；当前实现没有强制不可变性，所以“之前看过路径”会变成“以后永远能读路径”。建议按 round 使用不可变/hash 资产名，或只根据当前授权语义维护 manifest，并在资产更新时使旧授权失效。

#### 2-C：会话内部 symlink 绕过逻辑路径授权（High，需有 workspace/导入链路写入 symlink 的能力）

位置：`src/server/server.mjs:1785-1798`。当前只检查 `realAbs` 仍位于 session asset root 内；它没有检查 symlink 解析后的目标路径是否也在允许集合中。

实际夹具中创建：

```text
assets/private/secret.txt                 = PRIVATE
assets/public/internal-link.txt           -> ../private/secret.txt
public block 只引用 /assets/asset-path-probe/public/internal-link.txt
```

请求：

```http
GET /assets/asset-path-probe/public/internal-link.txt?token=alice-token
```

实际观测 HTTP 200，正文 `PRIVATE`。对比测试：直接请求 `private/secret.txt`、普通 `../`、编码 `%2e%2e` 都是 HTTP 403；指向 workspace 外部的 symlink 也会被拒。因此新增 realpath 检查挡住了外跳，但没有挡住“公开 symlink 名 → 会话内私有 inode”。

建议：资产目录拒绝所有 symlink（并检查每个路径组件），或使用 `open`/`fstat` 在同一个文件描述符上完成无跟随符号链接、目标路径/普通文件校验和读取；不能只校验 canonical root。

#### 2-D：引用提取的边界探针结果

这些形式没有把资产误判为公共，均是安全的 fail-closed，但有功能性 false negative：

| 形式 | 实际观测 |
|---|---|
| Markdown 图片 `![x](/assets/session/public/md.png)` | 清单出现，直读 200 |
| Markdown/HTML link、双引号 HTML `src` | 清单出现，直读 200 |
| URL 编码路径 `/assets/session/public/encoded%2Epng` | 清单出现，直读 200 |
| 相对路径 `assets/session/public/relative.png` | 清单不出现，直读 403 |
| 编码前缀 `/%61ssets/session/...` | 清单不出现，直读 403 |
| 单引号 `srcdoc` 和单引号 CSS `url('/assets/...')` | 清单不出现，直读 403 |
| 同资产重复引用 | Set 去重，清单只出现一次 |
| public/private 同时引用同一资产 | public 引用放行，直读 200 |
| 只有 Bob 私有 block 引用 | 清单不出现，直读 403 |

单引号失败的原因是正则第二段字符类包含 `'`，会把闭合单引号吃进路径；这不是泄漏，因为默认结果是拒绝。真正破坏安全边界的是 2-A 的外部 URL 子串误匹配。

### 3. feedback 读取/写入的未知 ID、`unanswered` 和异常 fail-open

结论：**已彻底修复（正常 HTTP/JSON 输入模型下）。**

位置：`src/server/server.mjs:418-444`、`src/server/server.mjs:597-620`、`src/server/server.mjs:1608-1638`。

读取侧现在同时裁剪 `items` 和 `unanswered`；未知 ID 不返回；当前 content 缺失或 JSON 损坏时 `feedbackVisibilityForIdentity().valid` 为 false，参与者得到 pending/无 feedback，而不是原样返回。

写入侧先验证当前 content，再一次性收集所有非法 ID。实际混合请求：

```http
POST /api/feedback
X-Workbench-Token: alice-token
Content-Type: application/json

{"session":"mixed-write-probe","round":1,
 "items":[{"blockId":"public","type":"text","value":"OK"},
          {"blockId":"bob-only","type":"text","value":"HIDDEN"}],
 "unanswered":["public","bob-only"]}
```

实际响应 HTTP 403，`error: 反馈包含不可见块：bob-only`；Alice 的 participant feedback 文件不存在，状态仍为 `rendered`，没有部分落盘。单独未知 ID、`unanswered` 隐藏/未知 ID、缺失 content、非法 JSON 也跑过，均未观察到泄漏或 fail-open。

残留注意：授权检查和写文件不是事务；如果另一个受信任进程在检查之后、写入之前改写同一轮 content，服务端可能把旧可见性判断用于写入。这不是通过当前参与者 HTTP API 单独触发的路径，建议把轮次内容做成不可变或用版本/锁绑定检查与写入。

### 4. participant 调用 `/api/retry`

结论：**已彻底修复。**

位置：`src/server/server.mjs:1737-1753`。

Alice 请求：

```http
POST /api/retry?session=mixed-write-probe&round=1
X-Workbench-Token: alice-token
```

实际响应 HTTP 403，`仅管理员可重试轮次`；预置的 `ack.json`、`error.json` 均仍在，状态没有被重置。非法 session/round 也先过白名单和 `validRoundQuery()`。

### 5. stream `refs.blockId` 和正文边界

结论：**只修了报告给的“引用字段可见”路径，隐藏 block 关联的普通事件正文仍然泄漏。**

位置：`src/server/server.mjs:465-482`。

当前对隐藏/未知 `refs.blockId` 的普通 event 调用 `stripHiddenStreamBlockRef()`，只删 `refs.blockId`，保留了整个 entry 的 `text`。这正好留下了把 block 正文放进 message text 的变体。

实际请求序列：

```http
POST /api/stream-events
X-Workbench-Token: owner-token
Content-Type: application/json

{"session":"stream-variants","kind":"message",
 "text":"LEAKED HIDDEN BLOCK BODY: BOB SECRET BLOCK",
 "refs":{"round":1,"blockId":"bob-only"}}

GET /api/messages?session=stream-variants
X-Workbench-Token: alice-token
```

实际观测：owner 写入 HTTP 200；Alice 读取 HTTP 200，entry 仍包含完整正文 `LEAKED HIDDEN BLOCK BODY: BOB SECRET BLOCK`，只是 `refs` 变成 `{round:1}`。未知 block ref 的 message 也保留正文。新增测试只断言 `refs.blockId` 被删除，没有断言隐藏事件正文不可见，因此 546 全绿没有覆盖该反例。

建议：对参与者，带隐藏/未知 block ref 的普通 message/progress/receipt 整条丢弃，或至少把正文裁成不含 block 内容的安全摘要；新增测试正文包含唯一秘密字符串并断言整个 entry 不出现。

### 6. participant 回答隐藏 ask、删除后的 ask、重复回答

结论：**只修了报告给出的直接路径；跨进程 TOCTOU 变体仍可用。**

位置：`src/server/server.mjs:484-496`、`src/server/server.mjs:1149-1182`、`src/stream.mjs:192-224`。

实际观测：

- Alice 对 `refs.blockId=bob-only` 的 hidden ask 提交 `POST /api/messages`，HTTP 403，错误为该 ask 关联 block 不可见。
- `answerTo=deleted-ask`，HTTP 400，`answerTo 对应的 ask 不存在`。
- public ask 首次回答 HTTP 200；同一 ask 第二次回答 HTTP 409，`ask 已回答`。
- `DELETE /api/messages?...` 返回 HTTP 404；当前没有 ask/answer 撤回或编辑路由，未找到可绕过 block 校验的替代操作。
- content round 缺失/损坏或 refs.round 无效时，`streamBlockRefVisible()` 返回 false，参与者按拒绝处理，而不是按公开处理。

补充竞态探针：另一个进程在 assertParticipantCanAnswerAsk() 的可见性读取之后把目标 block 从 Alice 改为 Bob；同一个 POST /api/messages 仍返回 HTTP 200 并写入 answer。检查和 appendAnswerEntry() 没有绑定同一 content 版本。

### 7. `_respondedToPrev` / `_decidedInPrev` 泄漏上一轮隐藏反馈存在性

结论：**已彻底修复（当前输出字段范围内）。**

位置：`src/server/server.mjs:1571-1588`。

实际 HTTP 探针：第 1 轮 Bob 私有 block 有 owner feedback item 和 `unanswered`，第 2 轮同 ID 改为 Alice 可见；Alice 请求：

```http
GET /api/content?session=history-feedback-probe&round=2
X-Workbench-Token: alice-token
```

实际响应 HTTP 200，block 为本轮 `_change: "new"`，没有 `_respondedToPrev`、`_decidedInPrev`，不含 Bob 的反馈正文。上一轮 feedback 缺失、非法和未知 ID 的变体也按默认不注入处理。

## 新发现与残留风险

### N-1（High）资产外部 URL 子串导致本地私有文件误授权

与第 2-A 相同，是当前 commit 新增引用提取逻辑的授权误判。触发条件、代码位置和 HTTP 证据见第 2-A。修复重点是“解析并验证真实本地 asset URL”，而不是继续扩展正则。

### N-2（High）内部 symlink 指向私有资产绕过允许路径集合

与第 2-C 相同。外部 symlink 已挡住，内部 symlink 仍在 `realRoot` 内而被当作合法文件读取。触发需要 workspace/导入链路能写入 symlink；当前 participant 上传 API 本身只写普通文件，所以这是导入、共享文件系统或其他本地进程参与时的真实边界问题。

### N-3（High，资产可变时）跨轮复用路径造成陈旧授权

与第 2-B 相同。资产授权按 session 内所有历史引用聚合，但读取的是当前可变文件。若设计要求资产不可变，应由文件名/hash/manifest 强制；否则不能把历史可见性当成当前文件的永久读取权。

### N-4（Medium，远程部署时）每请求扫描全部轮次的可用性放大点

位置：`src/server/server.mjs:331-345`；`/api/assets` 和每次 `/assets/...` 直读都会同步执行 `listRounds()`、逐轮 `readJSON()`、`validateContent()`、递归遍历 block 和正则提取，没有缓存、预算或速率限制。

真实测量夹具：400 轮 × 每轮 20 个 block，约 12 MB content，总共仅一个 session；参与者请求 `/api/assets` 一次为 HTTP 200、约 30.1 ms，8 个并发直读合计约 144.6 ms，全部 HTTP 200。每次直读都重新扫描全部轮次，所以请求数和历史数据量相乘；更大的会话或高并发可把单线程 event loop 压满。

这不是 ReDoS 结论：`ASSET_LINK_RE` 没有嵌套量词，2,097,083 字节的对抗性正文探针约 4.0 ms 返回，未观察到灾难性回溯。问题是无界全量 I/O/解析扫描。建议按 session/content 版本缓存授权 manifest，轮次新增或资产变更时失效，并对单请求扫描量和远端请求速率设上限。

### N-5（High availability，非本 commit 引入）畸形百分号路径会杀掉 server

位置：`src/server/server.mjs:1759-1761`。`decodeURIComponent()` 在后续 `try` 之前执行，没有捕获 `URIError`。

真实请求：

```http
GET /assets/no-session/%ZZ
```

在独立 server 进程中实际得到未处理 `URIError: URI malformed`，Node 进程退出码 1。`git blame` 显示这行来自更早的资产路由提交，不是 `3b42a25` 新增；但本次新增访问控制没有修掉它。启用口令时有效 participant token 即可到达该路由，因此它是远程可触发的可用性问题。应在 decode 周围捕获并返回 400/404。

### N-6（P1，条件性 TOCTOU）realpath 检查和文件读取不是原子操作

位置：`src/server/server.mjs:1775-1798`。授权集合先计算，随后 `realpathSync()` 检查，最后以路径 `readFileSync(realAbs)` 读取；另一个拥有 workspace 写权限的进程可以在检查和读取之间替换目标。普通 participant-only HTTP 夹具不能直接制造这个文件竞态，因此没有把它冒充成已被远程单独复现的泄漏；代码证据显示仍有窗口。

建议使用同一 fd 完成 `O_NOFOLLOW`/`fstat`/读取，或使用不可变资产 manifest。内部 symlink（N-2）是该类问题的非竞态、已实际复现版本。

证据更正：本次额外夹具已实际复现该竞态，不再只是理论风险。公共 block 起初引用 shared/screen.html，外部写进程在授权扫描期间同时把 block 改为 Bob 私有并把文件改写为 PRIVATE_NEW_ASSET；Alice 的 GET /assets/... 返回 HTTP 200 和 PRIVATE_NEW_ASSET，响应结束时 assignee 已为 bob。该项应按 P1 处理。

### N-7（P1 可用性）深层未知 JSON 字段可触发资产扫描栈溢出

位置：src/server/server.mjs:322-327、1286-1293、1775。

validateBlock 接受未知字段。owner 通过合法 POST /api/rounds 写入约 5000 层 deep.x.x... 后，Alice 的 GET /api/assets?session=deep-assets 实际返回 HTTP 500，服务端日志为 Maximum call stack size exceeded；同内容下直读 /assets/deep-direct/nope.txt?token=alice-token 触发 RangeError 未捕获，独立 server 进程 exit code 1。

建议改为显式迭代遍历并设置深度/节点预算，不能递归遍历用户可控 JSON。

### N-8（P1/P2 完整性）无 WORKBENCH_TOKEN 时 participant 可创建轮次

位置：src/server/server.mjs:1386-1391。

删除 owner token、保留 Alice 名册 token 后，Alice 的 POST /api/rounds 实际 HTTP 200，返回 round 1，内容落盘。原因是权限判断被 expectedToken 条件短路。无口令本地模式可以允许无 token 请求走 owner 兼容路径，但不应让已识别的 participant token 获得出题权；建议始终拒绝 identity.role 为 participant 的请求。

### N-9（P1）/api/proxy 未限制 SSRF

位置：src/server/server.mjs:1691-1734；该问题不是 3b42a25 引入，但属于本次复审覆盖的 HTTP 出口。

临时 loopback 服务返回 INTERNAL_ONLY_SECRET。Alice 请求 /api/proxy?url=http://127.0.0.1:<internal-port>/internal，实际 HTTP 200，响应 HTML 末尾包含 INTERNAL_ONLY_SECRET。应限制目标 origin，并在解析后阻止 loopback/private/link-local/metadata 地址和危险重定向。

### N-10（P2 条件性数据泄漏）/api/status 原样返回 error artifact

位置：src/server/server.mjs:1522-1526。

在 error.json.message 写入 STATUS_HIDDEN_ERROR_MARKER 后，Alice GET /api/status?session=probe-status-error 实际 HTTP 200，status.error.message 原样包含 marker。当前 listener 通常写通用错误，因此这不是已独立证明的 worker 自动回显；但 provider/integration 若把 prompt 或 block 内容写进错误文本，参与者可从该出口读取。建议对 participant 返回 error 字段白名单或通用文案。

## 实际攻击探针与结果总表

| 探针 | HTTP 结果 |
|---|---|
| public → Bob、Alice → Bob、Bob → Alice 同 ID 跨轮 diff | Alice 无 `removed`/旧正文；Bob 获得 changed；通过 |
| 上轮隐藏 feedback item + unanswered → 本轮可见 | 无 `_respondedToPrev`/`_decidedInPrev`；通过 |
| mixed visible + hidden feedback 写入 | 403；无 participant 文件、状态不变；通过 |
| participant `/api/retry` | 403；ack/error 保留；通过 |
| Markdown image、HTML link/双引号 attr、URL 编码、重复引用 | 200/清单正确；通过 |
| 相对路径、编码 `/assets` 前缀、单引号 CSS/srcdoc | 403；安全 fail-closed，但有功能缺口 |
| public/private 同资产混合 | 200；Set 去重；通过 |
| 外部 URL 子串碰撞本地私有路径 | `/api/assets` 列出，直读 200；失败 |
| 历史公共路径随后改成 Bob 私有并重写文件 | Alice 当前 content 为空，但清单/直读 200 新秘密；失败 |
| 内部 symlink → 私有文件 | 直读 200 私有正文；失败 |
| 外部 symlink、普通/编码 `..` | 非 200/403；通过 |
| hidden stream message | 200，refs 被删但秘密正文保留；失败 |
| hidden ask answer、deleted ask、public ask 重复回答 | 403、400、200 后 409；通过 |
| 2 MB 对抗性正文 | 200，约 4 ms；无 ReDoS 证据 |
| 400 轮/12 MB 全量扫描 | 单次约 30.1 ms，8 次约 144.6 ms；存在放大风险 |
| `/assets/no-session/%ZZ` | 独立 server 进程 URIError 退出码 1；基线 DoS |
| 深层 5000 层未知 JSON 字段 | /api/assets HTTP 500；/assets 直读使进程 exit 1 |
| 无 owner token 的 participant /api/rounds | HTTP 200，成功创建 round |
| participant /api/proxy 指向 loopback | HTTP 200，返回内部服务正文 |
| asset/answer 跨进程 TOCTOU | 内容已变为 Bob 私有后，仍分别返回新私有资产/写入 answer |

## 新增测试反例覆盖评估

新增 `tests/unit/block-visibility.test.mjs` 是真实 HTTP server 测试，不是纯 helper 测试，已覆盖：

- 三种主要跨轮 assignee 变化和 fingerprint；
- 上轮 feedback 可见性；
- 当前可见/隐藏资产清单、prototype iframe/image、Markdown link、embed、公共共享资产；
- hidden/unknown stream ref、hidden ask answer；
- `items`、`unanswered`、未知 ID、缺失/损坏 content 的 feedback；
- participant retry、token 吊销。

但没有覆盖这些反例：

- 外部 URL 子串、URL 真实 origin、相对/编码前缀、单引号 CSS/srcdoc、HTML entity；
- 同一资产跨轮重写、历史路径复用、内部 symlink/hardlink；
- 资产引用提取异常后的 default-deny、畸形百分号路径、全量扫描性能和竞态；
- hidden stream 普通 message 的正文必须消失；测试只检查 `refs.blockId` 被删除；
- hidden/deleted ask 的直接 answer、无撤回/编辑替代路由、mixed feedback 的原子拒绝。
- 深层未知 JSON、无 owner token 的 rounds、participant SSRF、status error artifact、asset/answer TOCTOU。

## 合并建议

**不能合进 `main`。** 至少在合并前修复并增加回归测试：

1. 资产引用改为严格解析本地 URL，修复外部 URL 子串误授权；资产使用不可变/versioned manifest，解决跨轮重写授权；拒绝 symlink 或按 fd 做无跟随符号链接的原子读取。
2. 隐藏/未知 block ref 的普通 stream event 不向参与者返回正文；补唯一秘密字符串断言。
3. 捕获资产路由的 `URIError`，并对可见资产 manifest 做缓存/版本失效和扫描预算。
4. 修复无 owner token 的 rounds、SSRF、递归崩溃和 status artifact，再补齐上述反例的真实 HTTP 回归测试并重跑全量测试。

## 验证记录

- `node --test tests/unit/block-visibility.test.mjs tests/e2e/session-stream.test.mjs tests/e2e/server.test.mjs`：93/93 通过。
- `npm test`：546/546 通过。
- 真实 HTTP 临时 server：资产变体、跨轮资产复用、内部/外部 symlink、diff/feedback/retry、stream 正文/ask、性能和畸形路径均已实测。
- 全量测试中仓库已有的 resident-worker 测试会在其独立临时 Git 仓库内演练快照提交；本次审查没有对目标审查仓库执行 Git 写操作，源文件未改动。
