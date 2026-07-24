# 常驻 worker 加固代码快查

日期：2026-07-24  
范围：本仓库现有实现与 `../user-vibeloop/docs/09-platform-vision-and-scenarios.md` §5.6

## 结论

1. Codex 的项目执行目录已经由 `/api/session-context` 返回的 `executionContext.primaryProject.repoPath` 决定，`scripts/resident-worker.mjs` 的 `processTask` 是执行结束后做善后的唯一合适入口。
2. 现有超时逻辑会终止 Codex 进程组，但只写固定超时回执，没有检查目标仓库。快照必须在子进程 `close` 后执行，且仅覆盖超时或非零退出。
3. Git 仓库判定不能只依赖 `git rev-parse` 成功；工作台的 `workspace/` 位于工作台仓库内，也会被父仓库识别。必须额外要求 `repoPath` 的真实路径等于 `git rev-parse --show-toplevel`，并显式拒绝默认及 `WB_WORKSPACE` 指定的数据目录。
4. `/api/rounds` 是远程 `present` 的首轮写入口。当前首轮会创建目录、轮次、状态和流回执，但不会写 `session.json`；成功响应也没有会话归属 warning。
5. 项目注册表已经用 `primarySession` 和 `aliases` 表示已注册项目会话。新会话可以用这些字段（兼容项目 ID 本身）判断是否属于注册项目；未命中时写默认元数据后会由现有目录逻辑显示在“待归类”。

## 验证策略

- 用临时真实 Git 仓库验证：脏改动被提交到固定时间戳分支，原分支恢复干净，提交信息包含 session 和中断原因。
- 用普通临时目录验证非 Git 路径跳过；用注入失败的 Git 执行器验证失败后不继续清理且工作文件保留。
- 用远程 `/api/rounds` E2E 验证首轮 warning、`session.json` 默认值、项目注册命中与后续轮次不重复 warning。
- 用真实 CLI 子进程验证 `present` 把服务端 warning 打到 stderr，同时保留在 stdout JSON。

