# Codex 第三轮方案评估（2026-08-30）

**结论：还有 1 条开工前硬伤，补齐后即可进入实现。** 以下仅按“否则会让实现走错
或验收测假”判定；实现时可再细化的接口形状不列为阻断项。

## 1. 上轮三项放行条件

| 上轮条件 | 判定 | 依据 |
|---|---|---|
| fs 白名单穷尽且一致 | **未闭合：1 个漏项** | 04 §1:9 声称表穷尽“所有含 `node:fs` 的生产调用”，并以表覆盖 02 §1 的旧措辞；这一优先级说明已消除“仅 storage/CLI”的文字冲突。但源码仍有直接调用未入表：`scripts/import-prd-project.mjs:23` 导入 `readFileSync/mkdirSync/writeFileSync/copyFileSync`，且会读外部输入、写 workspace。表却单列了另两个 `scripts/` worker（04 §1:27），没有给该脚本迁入 storage、显式例外或明确排除的规则。于是守卫的扫描范围无法唯一确定，不能证明“其余一律失败”。 |
| 机 A resident 衔接 + 开关矩阵 | **闭合** | 04 §6 已把 listener 与 resident 定义为共享触发、原子 rename 认领、`ack` owner/租约/retry 的两个 driver，而非虚称同一实现；各自写回（下一轮或 commit+receipt）和凭据归属明确。04 §7 覆盖 listener、resident、inbox 读写、dispatch、control-tower 和 driver 凭据的 off/on 行为，并要求逐格测试。现码确实仍是两条不同支路（`listener.mjs:50-130` 与 `resident-worker.mjs` 的 `codex exec` 流程），故这份接入契约是必要且足以指导改造。 |
| 错误分类 + D11 凭据边界 | **闭合** | 04 §8 将 JSON 解析、业务、鉴权、缺失、冲突、storage/errno 分为可测的 HTTP 映射；storage 故障固定为不泄漏细节的 500，正好修正现 `feedback.mjs:173-175` 的总 catch→400。04 §4 同时规定可注入 vault resolver、失败语义、最小子进程 env、全链路脱敏、Claude/Codex 的凭据隔离和 session-id 不跨 agent 复用，已能写离线契约测试。 |

## 2. 唯一硬伤与最小修订

在 04 §1 给 `scripts/import-prd-project.mjs` 补一条确定归属：

- 若它仍是受支持的可执行导入工具：迁入 storage，或作为 CLI/迁移工具显式例外并限制其允许的 I/O；
- 若它明确只是历史一次性脚本：写明 guard 扫描范围排除它，并说明不属于生产代码。

同时让 `fs-boundary.test.mjs` 按该范围扫描，确保此决定不是仅存在于文字表中。这个修订决定
“所有 fs 调用”实际覆盖谁；不做，迁移时可能遗留越界 I/O，或靠缩窄测试获得假绿。

未将下列内容列为阻断：apikey 的具体 argv 排列、worker-state API 与本地状态例外的最终取舍、
假 driver 的测试夹具形状；04 已固定它们必须满足的行为和验收边界，可在实现期据此落定。

## 3. 一句话结论

**还有 1 条硬伤必须先解决：补齐（或明确排除）`scripts/import-prd-project.mjs` 的 fs 白名单归属；完成后可进入实现。**
