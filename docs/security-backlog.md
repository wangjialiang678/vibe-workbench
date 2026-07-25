# 工作台安全债 / 未来计划

> 2026-07-25 立档。背景：在「vibeloop decisions 复用工作台渲染」任务中，为加入「按卡可见性（block.assignee）」做了两轮对抗性安全复审，掀出工作台一批安全问题。创始人拍板（round 9）：**商用前不为安全过度设计，功能/体验/稳定性优先，纯安全问题挂账到本文档，正式商用前再处理。**
>
> 因此本文件是**明账**：以下问题**当前已知未修**，在启用相关能力时需注意其限制。已修的稳定性问题（DoS、数据一致性）不在此列，见各自 commit。

## 判定原则

- **稳定性问题**（进程崩溃、数据不一致）→ 已修或该修，不进本文档。
- **纯安全问题**（越权读取、SSRF、信息泄露）→ 未商用阶段影响可接受，挂账于此。

## 前置事实：多数问题当前不可达

- 这些漏洞**只在实际使用「按卡可见性」（给某个 block 设了 `assignee`）时才可达**。未设 assignee 的轮次 = 全公开块，走原有全可见路径，不触发。
- 工作台线上当前所有 session 均未使用 assignee，故**线上现状不可达**。
- vibeloop 推送的决策卡是纯 `choice`/`markdown`，**不引用任何 `/assets/` 资产**，故资产类漏洞对 vibeloop 用例不可达。

## 挂账清单（按严重度）

### A. 资产授权：设计问题，需重构而非打补丁

根因：资产可见性靠「正则扫描 block 内容里的 `/assets/` 子串」判定——用字符串匹配做安全边界，注定按下葫芦浮起瓢。两轮复审后仍有变体：

- **H-1 协议相对 URL**：`//evil.example/assets/<session>/private/x` 被截成本地路径，授权本地私有文件。
- **H-2 硬链接绕过**：`O_NOFOLLOW` 挡住 symlink，但硬链接仍可把私有 inode 放到已授权路径。
- **H-3 版本 TOCTOU**：资产路径授权与当前文件版本无原子绑定；检查后替换文件可读到私有内容。
- **跨轮陈旧授权**：显式请求历史轮次时，历史公共授权仍可读当前已改写成私有的同名资产。

**正解（未来做）**：资产改为不可变、版本化/哈希命名的 manifest；授权只依据「被请求那一轮的可见引用」，绑定到具体资产版本；用完整 URL token 严格解析（协议相对/外部/带认证信息一律拒绝）；读取时授权版本与打开的 fd 绑定。

**过渡期约束（文档级，不写代码）**：`assignee` 可见性对「引用了私有资产的 block」不保证隔离。启用 assignee 时，私有卡不要挂敏感的 prototype/embed/image 资产。vibeloop 决策卡天然满足（无资产引用）。

### B. stream answer 事件正文泄漏（H-4）

隐藏 `refs.blockId` 的 message/progress/receipt 正文已整条丢弃，但**answer 事件正文未纳入该规则**。仅工作台原生 quick-decision（stream ask）产生 answer；vibeloop 不用 stream ask，不可达。修法：answer 事件也纳入「隐藏 ref → 整条丢弃」。

### C. DoS 变体（部分已修）

- 资产路由 `decodeURIComponent` 未捕获 URIError → 一个请求打死进程：**已修**（见工作台可见性修复 commit，实测 `%ZZ`/裸`%` 返回 400 且进程存活）。属稳定性，已处理。
- **残留**：当前轮递归遍历用户可控 JSON 时，资产清单可返回 500、资产直读路由仍可能使进程退出；轮次/资产全量扫描无上界（放大点）。修法：给遍历加深度/节点/字节预算，统一捕获授权计算异常。

### D. 历史遗留（非本次引入）

- **/api/proxy SSRF**：历史遗留，与本次改动无关，复核仍存在。
- **/api/status error artifact 泄漏**。
- **无 `WORKBENCH_TOKEN` 时，已识别的 participant 仍能通过 `/api/rounds` 创建轮次**。

## 触发条件速查

| 挂账项 | 可达前提 |
|---|---|
| 资产授权 A | 启用 assignee **且** 私有 block 引用了 `/assets/` 资产 |
| answer 正文 B | 启用 assignee **且** 使用 stream ask quick-decision |
| DoS 残留 C | 任意请求（与 assignee 无关）；进程有 systemd `Restart=always` 兜底 |
| 历史遗留 D | 与本次改动无关，独立存在 |

## 复审报告存档

完整的可复现请求序列见对抗复审报告：
- `reviews/CODE-REVIEW-fee462f.md`（首轮，7 条）
- `reviews/CODE-REVIEW-3b42a25.md`（一轮对抗复审，证伪首次修复 + N-1~N-6）
- `reviews/CODE-REVIEW-56275e6.md`（二轮对抗复审，本文档挂账项的权威来源）
