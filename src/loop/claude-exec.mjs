// claude-exec.mjs — 保留原 Claude Code driver API。
// 实现统一放在 agent-exec，避免三方适配器复制 spawn / 超时 / 脱敏逻辑。
export {
  buildArgv,
  parseStreamJson,
  redactSecrets,
  runClaude,
} from './agent-exec.mjs';
