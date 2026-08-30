// Present 的唯一用例入口：CLI 与 HTTP 共享同一轮次不覆盖不变量。
import { createRound } from '../storage/index.mjs';

export function presentRound(session, content, { exactSession = false, hooks = {} } = {}) {
  const saved = createRound(session, content, { exactSession });
  hooks.afterCreate?.(saved);
  return saved;
}
