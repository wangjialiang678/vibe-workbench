// Present 的唯一用例入口：CLI 与 HTTP 共享同一轮次不覆盖不变量。
import { appendJournal, createRound } from '../storage/index.mjs';

export function presentRound(session, content, { exactSession = false, hooks = {}, journal = {} } = {}) {
  const saved = createRound(session, content, { exactSession });
  try {
    appendJournal(session, {
      event: 'round.presented', round: saved.round, actor: journal.actor || 'system',
      requestId: journal.requestId, outcome: 'success',
    }, { exactSession });
  } catch (error) {
    console.error('[workbench:journal]', { session, round: saved.round, actor: journal.actor || 'system', requestId: journal.requestId, op: 'round.present', outcome: 'journal-failed', error: error.message });
  }
  hooks.afterCreate?.(saved);
  return saved;
}
