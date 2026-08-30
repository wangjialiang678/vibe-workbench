# Codex 第二轮方案评估（2026-08-30）

**结论：还需补 3 点后进入实现，不能放行。** 修订已实质修正“把反馈续跑
误当 inbox”的主错误，并补上了大部分验收骨架；但三项放行条件中，fs 边界和
状态机开关矩阵仍不是可直接编码/守卫的单一契约，D11 也缺少安全的凭据解析契约。

## 1. 上轮 3 项放行条件

| 上轮条件 | 判定 | 依据 |
|---|---|---|
| fs 边界例外表 | **部分补齐，未放行** | 04 §1 首次列出 storage、static、CLI、config、测试及既有 I/O 的迁入归属，方向正确；但它与 02:27 “仅 storage/CLI”矛盾。更重要的是白名单未处置 `src/loop/agent-exec.mjs` 的可执行文件探测、`src/server/server.mjs` 的上传、`src/documents.mjs`，以及 `scripts/local-listener.mjs`/`resident-worker.mjs` 的状态 I/O。按 04:9 的“其余即失败”，这些现有生产文件无迁移落点，守卫无法落地。 |
| 两条状态机唯一数据流、开关矩阵、下一轮所有者 | **部分补齐，未放行** | 02 §3/§4 与 D12 正确分开机 A（feedback→ack/response）和机 B（inbox），并在 02:51 指定“下一轮”为 AI 侧、只能经 `core.presentRound`。但“统一开关”只是文字规则（02:61-63），不是覆盖 listener、resident-worker、`/api/inbox/*`、dispatch、control-tower、webhook 的开关矩阵；on 状态的 subscription/apikey 也未入矩阵。机 A 又称两实现共用同一状态机（02:49），而现 `resident-worker` 是读取 `/api/feedback` 后以 `codex exec` 写 stream，现 `loop/listener` 才写 ack/response（`src/loop/listener.mjs:50-130`）。目标态未规定 resident 如何转换到 ack/response/AI-present，故尚无唯一可验收数据流。 |
| 隔离夹具对拍 + adapter 续接契约 | **基本补齐，仍有一处精化** | 04 §3 已规定双副本、POST 的响应+文件树对拍、白名单归一化、超时和反向自检，解决共享可写夹具问题。04 §4 已覆盖 `-p --resume`、续接 id、非零/超时、原子 claim，足以约束 Claude adapter。基线仍写成“`pre-rearch-2026-08-30` 或指定 SHA”（04:41），实施前须冻结为一个实际 SHA；续接测试还应断言 agent 切换不复用异 agent 的 id（现码已有此语义：`session-store.mjs:20-24`）。 |

## 2. 状态机混淆是否改对

**概念层面改对了，但执行契约未闭合。** D12 与 02:43-59 已明确：反馈驱动自动续跑
不经过 inbox；inbox 是 pull/external-review 的独立租约队列。这正确回应了上轮问题。

剩余缺口是机 A 的两个消费者不能只写“共用”。须明确：resident-worker 是改为调用同一
`claim/process/respond/present` storage API，还是保留其 stream/Codex 协议并由一个明确 adapter
映射；二选一，并规定 ack 的 owner、崩溃后 lease/retry、response 到下一轮 content 的交接格式。
否则 03 的假 driver e2e 只能证明 listener 支路，不能证明东京 worker。

## 3. 三个实现陷阱的契约覆盖

| 陷阱 | 判定 | 依据 |
|---|---|---|
| ack 非原子 claim | **覆盖** | 04:60-61 和 03:53 明确禁止 `exists→writeJSON`，要求 storage rename 竞争且并发只一人成功。 |
| CLI/HTTP present 副作用不同 | **覆盖** | 04 §5 将共同语义和 HTTP metadata/stream/dispatch hooks 逐项列出；实现时应给 CLI 空 hooks、HTTP 全 hooks 的行为测试。 |
| 写盘错误误归类为 JSON | **未覆盖，阻断** | 04 §2 只定义原子写/故障注入，04 §4 只定义 driver 错误；没有规定 handler 的错误分类。现 `feedbackPost` 的异步总 catch 仍将任何写盘错误回为 400 `invalid JSON`（`src/server/routes/feedback.mjs:173-175`）。须契约化：解析失败才 400；业务校验为对应 4xx；storage/errno 为 5xx；服务端记录 cause、客户端不给绝对路径或密钥。02:85 “5xx 且含真因”也应改为此安全表述。 |

## 4. D11 凭据模式

**可测但尚不可安全落地。** 04 §4 的 spawn argv/env 断言使 subscription 与 apikey 的选择可
离线测试，且 D11 不硬编码密钥的方向正确。

仍有三个盲区：

1. `api-vault` 没有可注入的解析接口、缺失/无效凭据的失败语义、脱敏与日志边界；测试无法证明
   key 未进入 journal/status/error/返回体。subscription 还须显式从子进程 env 移除继承的
   `ANTHROPIC_API_KEY`，不能只检查 argv。
2. D11 描述的是 `claude -p`/Anthropic key，但 02 把 `codex exec` 的 resident-worker 也纳入机 A。
   必须给每个 driver 标注凭据适用性；不能让 Anthropic key 模式隐含影响 Codex worker，或让该
   worker落在未定义的认证模式。
3. “argv 不依赖登录态”不可断言。应指定 apikey 的完整 argv、允许的 `--resume` 语义，以及
   两种模式下 session id 是否同一命名空间；同时测 resolver 失败、spawn env 最小化和输出脱敏。

## 5. 开工前必须解决

1. 将 02 的 fs 守卫改为引用 04 的**精确路径白名单**，逐一给所有现有 `node:fs` 生产调用迁入
   storage、保留例外或删除；static/config 的最终模块路径也要固定。
2. 补机 A/B × off/on × driver-auth × 各入口的开关矩阵，并定义 resident-worker 接入机 A 事实源
   的 adapter 协议；冻结对拍基线 SHA。
3. 增加 storage/HTTP 错误映射表，并补 D11 的 vault resolver、env 清洗、失败与脱敏契约测试。

## 6. 一句话结论

**还需补：fs 白名单一致且穷尽、机 A resident 衔接与完整开关矩阵、storage 错误分类及 D11 凭据边界；补完后可进入实现。**
