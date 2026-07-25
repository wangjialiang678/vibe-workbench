# 对抗性安全复审：56275e6

审查对象：56275e64322135a94ca2140dfea37b9a6669d91f

审查立场：把修复代码、设计文档和新增测试都视为不可信，主动寻找同类漏洞的变体。

审查期间没有修改源文件，没有执行 Git 写操作。所有临时工作区、HTTP 服务和竞态写进程均在 /tmp 下；交付文件是本报告本身。

## 总体结论

**不能合进 main。** 56275e6 修掉了上一轮已经覆盖到的普通路径，但仍有可通过真实 HTTP 触发的高风险问题：

1. 协议相对 URL 会再次被字符串扫描截成“本地 /assets/”，从而授权本地私有文件；外部 //evil.example/... 也能命中。
2. 显式请求历史轮次时，历史公共授权仍可读取当前已被改写成私有内容的同一路径资产。
3. 资产读取虽然改成同 fd + O_NOFOLLOW，但硬链接和检查后普通文件替换仍可把私有 inode/内容放到已授权路径下；实际 HTTP 竞态读到了私有内容。
4. 隐藏 block 的 message/progress/receipt 正文已丢弃，但带隐藏 refs.blockId 的 answer 事件仍保留正文。
5. 当前轮递归遍历用户可控 JSON 仍可让资产清单返回 500、让资产直读路由使 server 进程退出；轮次/资产全量扫描也只是缩小了内容范围，没有上界。
6. 没有设置 WORKBENCH_TOKEN 时，已识别的 participant 仍能通过 /api/rounds 创建轮次。

另有上一轮已经记录、但不是 56275e6 新引入的 /api/proxy SSRF 和 /api/status error artifact 泄漏，本轮也用 HTTP 复核仍存在。

## 上一轮残留逐条结论

### 原发现 1：跨轮 removed 泄漏旧 block

结论：**彻底修复（本轮未发现新变体）。**

当前目标测试中的真实 HTTP 夹具覆盖 public → Bob、Alice → Bob、Bob → Alice 的同 ID 跨轮变化，并断言 Alice 的响应不含旧正文；19 个 block visibility 测试全部通过。56275e6 没有把隐藏的旧 block 重新放进 removed。

### 原发现 2 / N-1：资产授权绕过 block 可见性

结论：**仍有多个可复现变体，不能算修复。**

- 普通“清单全量列出 + 直读任意隐藏路径”已挡住。
- 外部完整 http(s) URL 的 origin 比对能挡住 https://evil.example/... 和 http://user:pass@evil.example/...。
- URL query/fragment 中藏另一个私有路径时，解析仍只取 pathname；public/plain.txt?next=/assets/.../private/... 没有额外授权私有文件。
- http://127.0.0.1:<当前端口>/... 这种实际服务 origin 的本机 IP URL 会被接受；带 userinfo 但 origin 仍是本服务的 URL（http://user:pass@127.0.0.1:<port>/...）也会被接受。这不跨 origin，但说明实现没有拒绝带认证信息的 URL。
- 错端口、http://LOCALHOST:<port>（当前服务 origin 是 127.0.0.1）、双重编码路径、畸形 %ZZ、相对 assets/... 和编码前缀 /%61ssets/... 均默认拒绝。

真正失败的是协议相对 URL：assetUrlCandidates() 只在当前位置识别 http://、https:// 或 /assets/，因此遇到 //evil.example/assets/... 时，会在后续位置再次找到 /assets/ 子串，并把它作为本地路径解析。

实际 HTTP 夹具：公开 block 的正文同时放入以下两个值；本地同路径文件内容分别是 SECRET-private/proto.txt 和 SECRET-private/proto-evil.txt。

~~~
//127.0.0.1:<port>/assets/url-variants/private/proto.txt
//evil.example/assets/url-variants/private/proto-evil.txt
~~~

Alice 的请求：

~~~
GET /api/assets?session=url-variants
X-Workbench-Token: alice-url-probe
~~~

返回 200，清单包含 private/proto.txt 和 private/proto-evil.txt。随后：

~~~
GET /assets/url-variants/private/proto.txt?token=alice-url-probe
GET /assets/url-variants/private/proto-evil.txt?token=alice-url-probe
~~~

均返回 HTTP 200 和对应私有正文。代码位置：src/server/server.mjs:341-375，尤其是 assetUrlCandidates() 在任意偏移继续扫描 /assets/。

同一夹具还验证了 /assets/<session>/public/../private/dotdot.txt 会归一化后授权 private/dotdot.txt 并直读 200。这里是“可见 block 明确引用了归一化后的私有路径”而非单独的未授权路径发现，但实现没有对引用中的 .. 做 fail-closed。

### 原发现 2-B / N-3：跨轮陈旧资产授权

结论：**仍有变体；默认最新轮修复了历史并集，但显式历史轮接口仍泄漏可变文件的新内容。**

夹具：

1. 第 1 轮 public block 引用 /assets/round-auth/ui/same.html。
2. 第 2 轮只给 Bob 的 block 引用同一路径。
3. 文件当前内容改写为 SECRET-V2。

Alice 的默认请求返回 200、空清单；不带 round 的直读返回 403。这说明“默认当前轮”路径有效。

但：

~~~
GET /api/assets?session=round-auth&round=1
X-Workbench-Token: alice-url-probe

GET /assets/round-auth/ui/same.html?round=1&token=alice-url-probe
~~~

返回第 1 轮授权清单，直读 HTTP 200、正文为 SECRET-V2。授权依据是历史轮的 public 引用，读取对象却是当前可变文件。

删除第 2 轮再重建为 Alice 可见 public 轮后，缓存能失效并恢复 200；因此问题不是普通缓存陈旧，而是 round 授权没有绑定不可变的资产版本。代码位置：src/server/server.mjs:397-431、1981-1994。

### 原发现 2-C / N-2：symlink

结论：**稳定路径的 symlink 变体彻底修复；同一边界仍有硬链接和竞态变体。**

真实 HTTP 夹具中：

- public/link.txt -> ../private/secret.txt：直读 403。
- public/nested/linkdir -> ../../private/nested：中间路径组件 symlink，直读 403。
- /api/assets 不把 symlink 列入清单。
- 路径外部 symlink 也未读到内容。

这部分由 lstat 组件检查和最终 O_NOFOLLOW 挡住，代码位置：src/server/server.mjs:497-562。

但是硬链接不是 symlink：

~~~
private/secret.txt  = PRIVATE
public/hardlink.txt -- hard link 到 private/secret.txt
public block        引用 /assets/fs-boundary/public/hardlink.txt
~~~

Alice 的 /api/assets 清单包含 public/hardlink.txt，直读 HTTP 200，正文为 PRIVATE。这要求导入链路或同机写入者能够创建硬链接；当前 participant 附件上传 API 本身不会创建硬链接，但不能把共享 workspace/导入链路假定成不会发生。

### 原发现 5：stream refs.blockId 和正文边界

结论：**普通三类事件已修复；answer 事件仍有可复现正文泄漏。**

真实 HTTP 写入 message、progress、receipt 的隐藏 block ref 后，Alice 的 GET /api/messages 不再收到三类正文。当前轮不存在的 refs 也不返回。数组形式的 refs.blockId 得到 HTTP 400；额外放入 refs.blockIds 不会改变 blockId 的隐藏判断。

但我在 append-only stream 中放入一个带隐藏 block ref、但 answerTo 指向 public ask 的 answer entry，再通过真实 HTTP 读侧验证：

~~~
{
  "kind": "answer",
  "text": "ANSWER-HIDDEN-REF-SECRET",
  "refs": {"round": 1, "blockId": "bob-only"},
  "answerTo": "public-ask"
}
~~~

Alice 的 /api/messages 返回该 entry，refs.blockId 被删除但 text 仍为 ANSWER-HIDDEN-REF-SECRET。代码位置：src/server/server.mjs:656-673：只有 message、progress、receipt 整条丢弃，其他带隐藏 ref 的 kind 走 stripHiddenStreamBlockRef()。

建议对任何带隐藏/未知 block ref 的非公开事件统一整条丢弃，或对 answer 也采用按身份安全裁剪；不能只删除引用字段。

### 原发现 6：参与者回答隐藏 ask / N-6 answer TOCTOU

结论：**普通隐藏 ask 已修复；检查和写入仍未绑定同一内容版本，竞态仍可复现。**

普通 HTTP 请求对隐藏 ask 返回 403，对删除 ask 返回 400，public ask 首次回答 200、重复回答 409。

第二轮额外做了真实 HTTP 竞态：

1. target block 初始为 public，并关联到 10 个不同 ask。
2. 每次 POST /api/messages 前，子进程在 1/2/3/5/8 ms 后用原子 rename 把同一轮 content 改成 target.assignee = "bob"。
3. participant 通过 HTTP 回答各 ask。

10/10 个 POST 都返回 HTTP 200；每次响应后磁盘上的当前 content 都已经是 Bob 私有版本。说明 assertParticipantCanAnswerAsk()（src/server/server.mjs:676-687）和 appendAnswerEntry()（src/server/server.mjs:1347-1354）之间仍然没有版本/锁绑定。

### 原发现 7：上一轮隐藏 feedback 的存在性标记

结论：**彻底修复（本轮未发现新变体）。**

当前真实 HTTP 测试在上一轮 Bob 私有 block 写入 owner feedback、下一轮改指派给 Alice 时，Alice 得到的 block 没有 _respondedToPrev 或 _decidedInPrev，并且没有隐藏 feedback 正文。当前目标测试通过。

## 上一轮新增 N 项的状态

| 编号 | 结论 | 本轮证据 |
|---|---|---|
| N-1 外部 URL 子串误授权 | **未修复** | //evil.example/assets/... 和 //127.0.0.1/assets/... 均进入 Alice 清单并直读 200；见上文原发现 2 / N-1。 |
| N-2 内部 symlink | **稳定路径已修复** | 最终组件和中间组件 symlink 均 403；硬链接变体仍可读私有 inode。 |
| N-3 跨轮陈旧授权 | **仍有变体** | 显式 round=1 读取当前 SECRET-V2；见上文原发现 2-B / N-3。 |
| N-4 全量扫描放大 | **缓解但未修复** | 只读当前轮内容，但 listRounds() 和资产递归清单仍无界；3000 个轮次目录 + 3000 个资产文件的 HTTP 清单请求实际约 36 ms，新增文件导致再次扫描约 21 ms。 |
| N-5 畸形百分号 decode | **彻底修复** | %ZZ、裸 %、截断 %E0%A4%A 和 8000 字符路径均返回 4xx，随后 /api/health 仍 200；静态路由和 participant ID 路由也未杀进程。 |
| N-6 资产/回答 TOCTOU | **未修复** | 资产普通文件替换竞态 1000 次 HTTP 读中实际读到 FILE-RACE-PRIVATE-SECRET；回答竞态 10/10 HTTP POST 在 block 改为 Bob 后仍 200。 |
| N-7 深层未知 JSON 递归崩溃 | **未修复** | 5000 层未知字段：GET /api/assets 返回 500；GET /assets/deep-assets/public.txt 使独立 server 进程以 code 1 退出。 |
| N-8 无 owner token 时 participant 创建轮次 | **未修复** | 删除 WORKBENCH_TOKEN、保留 Alice 名册 token 后，Alice 的 POST /api/rounds 返回 200，round-1/content.json 实际落盘。 |
| N-9 /api/proxy SSRF | **仍存在；非本 commit 引入** | Alice 请求代理到临时 loopback HTTP 服务，返回 HTTP 200 和 INTERNAL_ONLY_SECRET。 |
| N-10 /api/status error artifact | **仍存在；非本 commit 引入** | error.json.message = STATUS_HIDDEN_ERROR 后，Alice 的 /api/status HTTP 200 原样包含该 marker。 |

## 新发现

### H-1：协议相对 URL 仍可把外部 URL 截成本地资产引用

严重度：**High，阻断合并**

问题：新 assetUrlCandidates() 试图只接受完整 URL 或字面量本地绝对路径，但实现仍对整个字符串逐字符扫描。协议相对 URL 的前缀 //host 未被识别，后面的 /assets/ 被当成本地候选。

触发场景：公开 block 中包含 //evil.example/assets/<session>/private/secret.txt，本地同路径只被 Bob block 引用或根本没有 Alice 可见本地引用。

位置：src/server/server.mjs:341-375。

建议：先按字段/语法解析完整 URL token，再判断 URL 的 origin 和 pathname；不要对未确认边界的任意文本继续寻找 /assets/。无法确认是本服务 origin 的值默认拒绝。

### H-2：硬链接绕过“路径授权”暴露私有 inode

严重度：**High（依赖导入/共享 workspace 写能力）**

问题：lstat、O_NOFOLLOW 和 realpath 都不能区分硬链接。只要可见 block 引用一个指向私有文件 inode 的硬链接名，服务就按该名授权并读出私有正文。

位置：src/server/server.mjs:497-562、1987-2003。

建议：资产导入时拒绝 hardlink/symlink，或建立不可变、受控的资产复制/哈希 manifest；不能把 O_NOFOLLOW 当作 inode 级隔离。

### H-3：资产路径授权与当前文件版本没有原子绑定

严重度：**P1（依赖有权限的并发写入者）**

问题：授权集合计算与 readAssetFile() 的 fd 打开之间没有版本锁。新代码确实避免了“realpath 后再按路径读”的最终 symlink 路径，但普通文件可在检查后被替换。

复现：公开 block 授权 public/screen.html；并发进程在 1000 次真实 HTTP 直读期间反复把该路径替换为包含 FILE-RACE-PRIVATE-SECRET 的普通文件。实际收到 HTTP 200 私有正文。

位置：src/server/server.mjs:403-431、532-562、1987-2003。

建议：资产命名/manifest 不可变；授权和文件描述符/manifest 版本绑定；若允许更新，更新时使旧授权失效并做版本检查。单纯同 fd 只能稳定读取一个 inode，不能证明这个 inode 在授权时就是同一个允许版本。

### H-4：隐藏 ref 的 answer 正文未纳入整条事件丢弃规则

严重度：**High（依赖受信任 stream producer 写入带 refs 的 answer）**

问题：隐藏 block ref 的 answer 事件走“删 blockId、保留 entry”分支，正文可以承载隐藏 block 内容。

位置：src/server/server.mjs:667-673。

建议：统一按事件的 block 关联做 allowlist；隐藏/未知 block ref 的 answer 与普通事件一样整条不返回。

### M-1：当前轮资产扫描和引用递归仍无预算

严重度：**Medium availability；深层输入时升级为 P1 崩溃**

问题：56275e6 把授权内容从“所有轮次”缩成“选定轮次”，但 selectedAssetRound() 仍无界列出轮次，listSessionAssets() 仍递归遍历整个资产树，collectAssetPaths() 仍递归遍历 block 的所有对象/数组字段。

位置：src/server/server.mjs:380-400、434-495。

实际结果：3000 个轮次目录和 3000 个资产文件的 /api/assets 请求返回 200，但首请求约 36 ms；新增未授权资产导致缓存失效后再次约 21 ms。5000 层未知字段则触发 N-7 的 500/进程退出。

建议：授权 manifest 按版本缓存只是优化，不是安全上界；应设置轮次、节点、深度、文件数量和总字节预算，并使用迭代遍历。资产直读路径需要把授权计算放进统一错误边界。

### P1-1：无 owner token 时 participant 仍可创建 round

严重度：**P1**

问题：/api/rounds 的权限判断是 if (expectedToken && identity.role !== 'owner')。当环境没有 owner token 但请求带有效 participant token 时，identity 已经是 participant，短路条件却放行。

位置：src/server/server.mjs:1586-1591。

实际 HTTP：Alice 带 X-Workbench-Token POST 合法 content，返回 200 并创建 no-token-round/round-1/content.json。

建议：始终拒绝 identity.role === 'participant'；无口令兼容只允许“无身份请求”的本地 owner 路径。

### P1-2：/api/proxy SSRF（历史遗留，非 56275e6 引入）

严重度：**High/P1**

真实 HTTP：Alice 请求 /api/proxy?url=http://127.0.0.1:<临时内部端口>/secret，代理返回内部服务正文 INTERNAL_ONLY_SECRET。

位置：src/server/server.mjs:1893-1932。

建议：解析并限制目标 origin；解析 DNS/IP 后拒绝 loopback、RFC1918、link-local、metadata 地址，并限制重定向目标。

## 实际攻击探针与观测总表

| 探针 | 实际 HTTP 观测 |
|---|---|
| //127.0.0.1:<port>/assets/.../private/proto.txt | /api/assets 列出私有路径，直读 200/私有正文 |
| //evil.example/assets/.../private/proto-evil.txt | 同样列出并直读 200/私有正文 |
| 外部完整 URL、外部 userinfo、错端口、LOCALHOST、相对路径、编码 /assets 前缀 | 未授权；清单不含，直读 403 |
| 同源 userinfo、本机 IP、同源 ../ | 同源 userinfo/IP 被接受；../ 归一化后进入允许集合并直读 200 |
| query/fragment 藏另一路径、双重编码、畸形 %ZZ | 未把隐藏路径额外加入授权；直读 403 |
| 默认最新轮、显式历史轮、同路径跨轮重写 | 默认最新轮 403；显式历史轮读到当前 SECRET-V2 |
| 最终 symlink、中间 symlink、外部 symlink | 均 403；清单不列 symlink |
| hardlink 到私有文件 | 清单列出 hardlink，直读 200/私有正文 |
| 资产普通文件替换 TOCTOU | 1000 次 HTTP 读中实际返回私有正文 1 次 |
| hidden message/progress/receipt | 写入 200，但 Alice 读取不到正文 |
| 当前轮不存在的 ref、refs.blockId 数组、额外 blockIds | 当前轮不存在的事件不返回；数组写入 400；额外字段不改变隐藏 blockId 判断 |
| answer 带隐藏 ref | Alice 通过 /api/messages 收到 ANSWER-HIDDEN-REF-SECRET |
| hidden ask / deleted ask / 重复 public ask | 分别 403 / 400 / 首次 200 后 409 |
| answer check/write TOCTOU | 10 次 participant HTTP POST 全部 200；磁盘 content 已改为 Bob 私有 |
| %ZZ、裸 %、截断多字节、8000 字符路径、participant ID decode | 返回 4xx/405，随后 health 200，server 存活 |
| 3000 轮次目录 + 3000 资产文件 | /api/assets 200；约 36 ms，缓存失效重扫约 21 ms |
| 5000 层未知 JSON | /api/assets 500；直读 /assets 使独立 server exit code 1 |
| 无 owner token + participant /api/rounds | HTTP 200，轮次文件实际落盘 |
| participant /api/proxy → loopback | HTTP 200，内部秘密返回 |
| participant /api/status + error artifact | HTTP 200，错误 marker 原样返回 |

## 测试基线与新增测试覆盖缺口

已执行：

~~~
node --test tests/unit/block-visibility.test.mjs   19/19 通过
npm test                                             550/550 通过
~~~

新增测试覆盖了正常当前轮授权、普通 symlink、基本外部 URL、隐藏三类 stream 事件、畸形百分号路径和缓存失效；但没有覆盖本报告的协议相对 URL、显式历史轮可变文件、硬链接、普通文件 TOCTOU、answer refs 正文、answer check/write 竞态、深层 JSON 崩溃、无 owner token participant 创建 round、SSRF 和 error artifact。

## 合并建议

在合并前至少需要：

1. 把资产引用改成完整 URL token 的严格解析，协议相对/外部/认证信息/异常形式默认拒绝，并补上实际本机 origin 的正反例。
2. 资产使用不可变版本化 manifest；显式历史轮必须绑定对应资产版本，不能读取当前可变同名文件。
3. 禁止 symlink 和 hardlink，或使用受控复制/哈希 inode；把授权版本与打开的 fd 绑定，并处理检查后替换。
4. 对所有隐藏/未知 block ref 的非公开事件整条丢弃；answer 也必须覆盖，补唯一秘密正文断言。
5. 给资产清单/引用遍历加深度、节点、轮次、文件和字节预算；统一捕获直读路径的授权计算异常。
6. participant 无论是否设置 owner token 都不能创建 round；另外修复历史 SSRF 和 status artifact 泄漏。

在这些问题修复并用真实 HTTP 反例回归前，**不能合进 main**。

