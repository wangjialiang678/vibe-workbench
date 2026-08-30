# DESIGN — Vibe Workbench 当前架构

> 本文描述已落地的工作台及其明确的运行边界。它从零开始可读；历史评审、迁移过程和已作废的增量说明留在 `docs/design/`，不再以“覆盖前文”的方式改变本文件。

## 1. 产品与硬约束

Vibe Workbench 把 AI 的一轮思考保存为可交互网页。用户在网页中选择、批注或改写，反馈先安全落盘；AI 可以由人工继续，也可以由受控的执行面续跑。

- 文件系统是事实源；`workspace/<session>/round-<n>/` 中的文件足以恢复一轮状态。
- Node ≥20、ESM、零运行时依赖。服务端只使用 Node 内置模块，浏览器直接加载原生 ESM。
- 前端固定亮色，`theme.css` 是全部视觉数值的唯一来源；`app.css` 只引用令牌。
- 默认安全：公网监听必须设置 `WORKBENCH_TOKEN`；参与者只看获授权的块和反馈。
- `WB_CLOUD_AI` 默认 `off`。关闭自动执行不影响 present、查看和 feedback 落盘。

## 2. 五层结构与依赖方向

```text
protocol/  ← 纯协议、校验、diff、注意力路由、状态显示
    ↑
storage/   ← 工作台文件读写、轮次独占、反馈历史、认领
    ↑
core/      ← 只保留跨入口且有不变量的用例（当前为 presentRound）
    ↑
adapters/  ← HTTP server / CLI / feedback listener / inbox 路由
    │
render/    ← 浏览器端；仅依赖 render/ 与 protocol/
```

这是中间态，而不是全量六边形架构。简单读取接口（例如读 status、content）可由 server adapter 直接调 storage；只有必须统一不变量的动作才进入 core。禁止让 render 依赖 server/storage，也禁止 routes 反向 import `server.mjs`。

| 层 | 责任 | 主要位置 |
|---|---|---|
| protocol | 不触碰 DOM、网络和文件系统的共享计算 | `src/protocol/` |
| storage | 唯一常规 workspace 文件出口；固化写入顺序与原子认领 | `src/storage/index.mjs` |
| core | 跨 CLI、HTTP、loop 共用的薄用例 | `src/core/present.mjs` |
| adapters | 把 HTTP、命令行、定时扫描等输入转成用例或 storage 调用 | `src/server/`、`bin/`、`src/loop/` |
| render | 把协议内容变成浏览器 DOM，保存本地草稿 | `src/render/` |

`tests/guards/layering.test.mjs` 检查 render 依赖与 src import 环；`tests/guards/fs-boundary.test.mjs` 将 `node:fs` 收敛到 storage 和少数明确边界（CLI、静态资产、部署元数据等）。

## 3. 协议：一轮内容与反馈

一轮的权威内容是 `content.json`；`content.md` 是同一内容的人读副本。跨轮同一议题必须复用 block id，diff 才能识别它是新增、变更还是未变。

```jsonc
{
  "session": "ses_example",
  "round": 2,
  "prevRound": 1,
  "title": "本轮主题",
  "blocks": [{
    "id": "b-decision",
    "type": "choice",
    "body": "需要拍板的问题",
    "needsDecision": true,
    "hasRecommendation": true,
    "recommendation": "safe",
    "importance": "high",
    "options": [{ "id": "safe", "label": "稳妥方案" }]
  }]
}
```

`schema.mjs` 校验内容，`lint.mjs` 对决策卡给出作者侧建议，`diff.mjs` 计算 `_change`，`attention.mjs` 将块稳定地路由到：需决策无推荐、需决策有推荐、仅供了解三个区域。block 类型由 `protocol/block-types/` 注册；渲染层不自行定义协议语义。

反馈由 `POST /api/feedback` 接收，含 block 选择、评语、改写、总评和未答项。服务端按身份校验可见 block：参与者不能提交未授权或不存在的 block；owner 保留历史兼容视图。

## 4. 存储：文件就是恢复点

```text
workspace/<session>/
  session.json                    会话与项目元数据
  status.json                     当前轮状态、心跳、错误
  round-<n>/
    content.json / content.md     AI 呈现内容
    feedback*.json / feedback*.md 反馈主件、参与者件、历史件
    ack.json                      机 A 的原子认领凭证
    response.md                   driver 的可读输出
    error.json                    本轮执行错误
```

storage 的关键不变量如下。

- `createRound` 以目录创建占位，同一 session/round 永不覆盖；冲突返回 `ROUND_EXISTS`。
- `appendFeedback` 先写带时间戳的历史件，再写主反馈和 status，因此反馈不因后一次提交而丢失。
- 反馈驱动认领使用 rename 竞争；两个 worker 同时处理一轮时只有一个赢家。
- inbox 任务同样使用临时文件和 rename 维护租约，是独立队列状态机的原子写范本。
- 存储错误保留真实 errno，adapter 再映射为 HTTP 响应，不能伪装成“JSON 无效”。

## 5. Core 与三个适配入口

`presentRound` 是当前 core 用例：校验 content、委托 `storage.createRound`、返回 session 与 round。CLI `workbench present`、HTTP `POST /api/rounds` 以及 listener 生成下一轮都走它，因此三条路径共享“不得覆盖”的规则。

反馈提交的权限校验和 HTTP 形状仍在 server adapter；它调用 storage 的三步持久化事务。除非出现第二个需要共享这一用例的入口，不为了形式额外建立一层空壳。

| 适配器 | 输入 | 输出/职责 |
|---|---|---|
| server | HTTP 请求、身份、速率/大小限制 | API、静态 render 页面、CORS、鉴权 |
| CLI | `bin/workbench.mjs` 子命令 | present、wait、serve、up、文档发布 |
| loop | `src/loop/listener.mjs` | 扫描可处理反馈、认领、调用注入的 driver、写回结果 |
| inbox | `src/executor-inbox.mjs` + `/api/inbox/*` | 拉取型执行器的任务租约与状态推进 |

HTTP 路由都是精确路径或明确带尾斜杠的前缀；近似路径必须 404，不能被 `startsWith` 吞掉。认证在路由匹配前执行，避免未知 API 成为鉴权侧信道。

## 6. 浏览器渲染与草稿

`src/render/app.mjs` 负责本轮加载、分区、提交、轮询和交互绑定；`blocks.mjs` 负责 block DOM；`*-view.mjs`、`*-state.mjs` 将局部渲染和纯状态拆出。草稿存于 localStorage，键包含 session 和 round；刷新或前端自动更新不应丢失未提交内容。

页面通过 `assetsVersion` 和版本化 import map 处理长寿命标签页：关键资源更新后页面会刷新到同一版本的 HTML、CSS、模块和本地 mermaid。mermaid 使用脱离隐藏容器的 `mermaid.render`，单图失败时显示真实错误与原文，不把渲染期错误伪装成语法错误。

`app.mjs` 仍是整合入口。它的进一步事件委托/抽薄是低优先级纯重构：只有能保持对拍零差异、并可补足行为测试时才做，不以压行数为目标。

## 7. 两套独立状态机

两者都保留，但不能混为一条链。

### 机 A：反馈驱动的 AI 自动续跑

```text
feedback 已落盘且无 ack/response
  → 原子认领 ack
  → claimed
  → driver 执行
  → response + 下一轮 present
  → responded
              └→ error（可重试/冷启动对账）
```

- `workbench-continue`：listener 使用 Claude driver 产生工作台下一轮。
- `code-exec`：常驻 worker 可在目标仓库执行 Codex、提交并写回回执；它不受 Anthropic 凭据开关支配。
- subscription 模式执行 `claude -p --resume`，不注入 API key；apikey 模式仅向子进程注入从安全来源获得的 `ANTHROPIC_API_KEY`。凭据绝不写入 workspace、日志或 API 响应。
- listener 启动时 reconcile：只凭文件扫描未完成轮即可继续，无需内存状态。

### 机 B：inbox 任务队列

```text
pending → claimed → done
                  └→ failed
claimed 超过租约 → pending
```

机 B 服务拉取型执行器，例如 `local-mac`、`github-actions` 或外部评审。事件先按会话项目的 executor 路由；resident 类型走机 A，pull/external-review 类型入对应 inbox。它有独立的认领、续租和完成 API，不能把 feedback 文件当 inbox 任务。

## 8. 执行面开关矩阵

统一开关是 `WB_CLOUD_AI=off|on`，缺省和任何非 `on` 值都等同 `off`。顾问或客户线上需要自动处理时显式设为 `on`；开关不影响基础协作闭环。

| 场景 | `WB_CLOUD_AI=off`（默认） | `WB_CLOUD_AI=on` |
|---|---|---|
| present、内容读取、feedback 落盘 | 正常 | 正常 |
| 机 A listener / 自动 driver | 不启动、不认领 | 扫描、认领、写 response 与下一轮 |
| 机 B `/api/inbox/*` | 503“云端 AI 未启用” | 按权限和租约规则运行 |
| control tower | 明示“未启用” | 展示实际执行状态 |
| Anthropic 认证 | 不执行 | `WB_CLOUD_AI_AUTH=subscription`（默认）或 `apikey` |

## 9. Health 与部署诊断

`GET /api/health` 返回：

```json
{ "ok": true, "ts": 0, "version": "0.1.0", "commit": "unknown" }
```

`version` 在服务启动时从 `package.json` 读取。部署流程应在启动服务前执行 `node scripts/write-version.mjs [commit]`，将 commit 写进被 gitignore 的根目录 `version.json`；服务运行时只读取该文件，缺失或不可读时 `commit` 回退为 `"unknown"`。服务端**不得调用 git**。这是仅保留的部署可调试能力；不构建发布包、不做三机 SHA 对比、也不引入部署编排。

## 10. 主要 HTTP 契约

| 接口组 | 关键接口 |
|---|---|
| 内容与轮次 | `POST /api/rounds`、`GET /api/content`、`GET /api/status`、`POST /api/retry` |
| 反馈与对话流 | `POST/GET /api/feedback`、`POST/GET /api/messages`、`POST /api/stream-events` |
| 身份与项目 | `GET/POST/DELETE /api/participants`、`GET /api/sessions`、`GET /api/projects` |
| 文件与页面 | `POST /api/attachments`、`GET /api/assets`、`GET /render/` |
| 执行面 | `POST /api/worker-heartbeat`、`/api/inbox/*`、`GET /api/control-tower` |
| 诊断 | `GET /api/health` |

启用 `WORKBENCH_TOKEN` 后，页面通过 query token，API 接受 query 或 `x-workbench-token`；静态会话 assets 只接受 query token，避免 Referrer 泄漏。参与者名册每请求读取，因此撤销立即生效。

## 11. 测试与回归门槛

- `npm test`：Node 内置 `node:test` 的行为测试、golden 和结构守卫全量运行。
- `tests/golden/`：锁定 protocol 的 `computeDiff`、`routeBlocks` 和渲染分区输出。
- `tests/e2e/`：真实 HTTP 覆盖鉴权、可见性、轮次和两套执行面。
- `tests/guards/`：分层无环、fs 边界、零依赖等结构约束。
- `node scripts/ab-compare.mjs`：基线与当前树逐请求/逐写盘对拍，health 的 `version`、`commit` 是唯一显式 `expected-change`；`ts`、`assetsVersion` 是时间/资源版本归一化字段。
- `node scripts/ab-compare.mjs --self-test` 必须故意报差异并以退出码 1 结束，证明对拍器没有失效。

## 12. 已保留与已砍边界

| 保留 | 原因 |
|---|---|
| 文件系统事实源与 storage 收口 | 可冷启动接管，已具备原子写不变量 |
| protocol、原生前端、零依赖 | 协议可共享，浏览器无需构建链 |
| 机 A 自动续跑 | 顾问/客户反馈的核心执行能力，默认关闭以控制暴露面 |
| 机 B inbox 租约队列 | 重建成本高，已有正确的原子租约语义，默认关闭 |
| `/api/health` 版本与 commit | 最小的线上版本定位能力 |

| 已砍 | 原因 |
|---|---|
| 不可变发布包、manifest、三机 commit/SHA 比对 | 超出工作台职责，属于 D7 明确拒绝的部署自动化 |
| 全量六边形、每端点一个 use case、全量 DI | 会增加空抽象；简单读接口直接使用 storage |
| protocol 多版本迁移引擎 | 当前只需兼容性字段，不需要迁移系统 |
| journal 回放/事件溯源引擎 | 文件已经是事实源，追加记录不等于引入事件溯源 |

## 13. 运维恢复顺序

1. 先读取 `workspace/<session>/round-<n>/`、`status.json` 和 `error.json`，判断事实状态。
2. 检查 `/api/health` 的 `version` 与 `commit`；`commit: "unknown"` 表示部署元数据缺失，不表示服务不健康。
3. 在默认关闭状态，确认反馈已落盘后由人工处理；需要自动续跑时，设置 `WB_CLOUD_AI=on` 并重启相应服务。
4. 机 A 用 listener reconcile 扫描恢复；机 B 让过期租约回到 pending 后由正确执行器领取。

本文件只描述现行架构与明确边界。设计推演、历史故障复盘和未来讨论请新增独立设计文档，不在末尾追加“覆盖本文件”的章节。
