// 轮次 diff（DESIGN §5 + §13 P1）。零依赖。
import { blockFingerprint } from './schema.mjs';

const DIFF_FIELDS = ['type', 'title', 'body', 'options', 'recommendation', 'default', 'value'];

function fieldHash(v) {
  return JSON.stringify(v ?? null);
}
function pick(obj, fields) {
  const o = {};
  for (const f of fields) o[f] = obj[f] ?? null;
  return o;
}

// 返回 cur blocks（每个带 _change；changed 额外带 _changedFields 与 _prev 字段级对照）
export function computeDiff(curBlocks, prevBlocks = []) {
  const prevById = new Map();
  for (const b of prevBlocks || []) prevById.set(b.id, b);
  return (curBlocks || []).map((b) => {
    const prev = prevById.get(b.id);
    if (!prev) return { ...b, _change: 'new' };
    if (blockFingerprint(b) === blockFingerprint(prev)) return { ...b, _change: 'unchanged' };
    const changedFields = DIFF_FIELDS.filter((f) => fieldHash(b[f]) !== fieldHash(prev[f]));
    return { ...b, _change: 'changed', _changedFields: changedFields, _prev: pick(prev, DIFF_FIELDS) };
  });
}

// 上一轮有、本轮没有的块（DESIGN §13：移除项要可见）
export function removedBlocks(curBlocks, prevBlocks = []) {
  const curIds = new Set((curBlocks || []).map((b) => b.id));
  return (prevBlocks || []).filter((b) => !curIds.has(b.id));
}

// 只看变更：new + changed
export function filterChanged(blocks) {
  return (blocks || []).filter((b) => b._change && b._change !== 'unchanged');
}

// id 漂移健全性：本轮 new 占比过高且上轮等量 removed → 可能议题重组，diff 仅供参考
export function diffSanity(diffedBlocks, removed) {
  const total = (diffedBlocks || []).length;
  const news = (diffedBlocks || []).filter((b) => b._change === 'new').length;
  const rem = (removed || []).length;
  const suspect = total > 0 && news / total > 0.6 && rem >= Math.max(1, Math.floor(news * 0.6));
  return { suspect, news, removed: rem, total };
}
