# 常驻 worker 两项加固设计

## 目标与边界

本次只补齐两条现有链路：Codex 超时或非零退出后的项目仓库快照，以及服务端首次 `present` 时的新会话 warning/元数据。继续使用 Node.js 内置模块和系统 Git，不引入依赖，不修改或迁移 `workspace/` 数据。

## 中断快照

worker 在 Codex 子进程退出且进度心跳停止后，读取本次已经解析好的 `executionContext.primaryProject.repoPath`。候选目录必须存在、是绝对路径、真实路径不是工作台默认或 `WB_WORKSPACE` 数据目录，并且 Git 顶层目录必须恰好等于候选目录；否则跳过。

只有 `git status --porcelain` 非空时才创建 `codex-timeout-<UTC 时间戳>` 分支。worker 在新分支执行 `git add -A` 和中文提交，提交信息包含 session 与“超时”或“异常退出（退出码）”，再切回原分支并确认状态干净。任一 Git 操作失败后停止后续清理，保留当时文件现场，并把错误写入回执。

回执区分：快照成功、仓库干净、非 Git/受保护路径、快照失败。成功回执给出 `git switch <分支>` 后续跑的明确方式。

## 新会话命名提示

服务端在 `/api/rounds` 写第一轮前判断该 session 是否已有轮次。首轮成功后写 `session.json`：`title` 取本轮标题，`kind` 为 `work`，`status` 为 `active`。若 session 命中项目注册表的 `primarySession`、`aliases` 或项目 ID，同时写入对应 `projectId`；否则成功响应增加：

> 未归属项目的新会话，建议先在项目下创建或使用规范命名

未归属会话沿用现有目录规则显示为“待归类”。第二轮及以后不重复 warning，也不覆盖已有元数据。远程 CLI `present` 在保留 warning 字段的同时将其打印到 stderr，stdout 仍保持可解析 JSON。

## 测试

- worker：真实临时 Git 仓库成功快照；非 Git 跳过；受保护路径跳过；Git 失败保留现场；超时回执包含快照分支与续跑方式。
- server/CLI：未归属首轮 warning 与元数据落盘；注册项目会话不 warning 且自动归属；后续轮次不 warning；CLI stderr 打印 warning。
- 回归：定向测试后执行完整 `npm test`。

