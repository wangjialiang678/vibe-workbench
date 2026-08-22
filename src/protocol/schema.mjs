// 内容协议 schema 与校验（DESIGN §2）。服务端用（含 node:crypto）。
import { createHash } from 'node:crypto';
import { BLOCK_TYPES, IMPORTANCE, IMPORTANCE_RANK, FEEDBACK_TYPES, STATES, AUDIENCE } from './constants.mjs';
import { getBlockType } from './block-types/index.mjs';

export { BLOCK_TYPES, IMPORTANCE, IMPORTANCE_RANK, FEEDBACK_TYPES, STATES, AUDIENCE };

// 填充默认值（不修改入参）
export function normalizeBlock(b) {
  return {
    importance: 'normal',
    needsDecision: false,
    hasRecommendation: false,
    recommendation: null,
    default: null,
    ...b,
  };
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// 内容指纹：仅取影响"呈现"的字段，用于 diff（DESIGN §5 + §1.4 C）
export function blockFingerprint(block) {
  const subset = {
    type: block.type,
    title: block.title ?? null,
    body: block.body ?? null,
    options: block.options ?? null,          // 含 pros/cons：利弊变了即算 changed
    recommendation: block.recommendation ?? null,
    default: block.default ?? null,
    value: block.value ?? null,
    // 空串与省略/null 都是公共块，指纹也按同一语义归一化。
    assignee: block.assignee || null,
    // 决策块结构化字段（iteration-brief P1）：AI 补了背景/理由 → 该轮应标 CHANGED
    background: block.background ?? null,
    why: block.why ?? null,
    recommendReason: block.recommendReason ?? null,
  };
  // §1.4 C：新 block 类型的核心字段加入指纹，否则 diff 对新类型失效
  const definition = getBlockType(block.type);
  for (const field of definition?.hashFields ?? []) subset[field] = block[field] ?? null;
  return createHash('sha1').update(stableStringify(subset)).digest('hex');
}

export function validateBlock(block) {
  const errors = [];
  if (!block || typeof block !== 'object') return { ok: false, errors: ['block must be object'] };
  if (!block.id || typeof block.id !== 'string') errors.push('block.id required string');
  const definition = getBlockType(block.type);
  if (!definition) errors.push(`block.type invalid: ${block.type}`);
  if (block.importance != null && !IMPORTANCE.includes(block.importance)) errors.push(`importance invalid: ${block.importance}`);
  if (block.needsDecision != null && typeof block.needsDecision !== 'boolean') errors.push('needsDecision must be boolean');
  if (block.hasRecommendation != null && typeof block.hasRecommendation !== 'boolean') errors.push('hasRecommendation must be boolean');
  // 决策块结构化 + 受众分层 + live（iteration-brief 2026-07-13）：全部可选，旧内容不受影响
  if (block.background != null && typeof block.background !== 'string') errors.push('background must be string');
  if (block.why != null && typeof block.why !== 'string') errors.push('why must be string');
  if (block.recommendReason != null && typeof block.recommendReason !== 'string') errors.push('recommendReason must be string');
  if (block.audience != null && !AUDIENCE.includes(block.audience)) errors.push(`audience invalid: ${block.audience}`);
  if (block.live != null && typeof block.live !== 'boolean') errors.push('live must be boolean');
  // 按卡可见性：省略/null/空串表示公共块；非空值必须是非空字符串。
  if (block.assignee != null && (
    typeof block.assignee !== 'string'
    || (block.assignee.length > 0 && !block.assignee.trim())
  )) {
    errors.push('assignee must be a non-empty string when provided');
  }

  if (definition) errors.push(...definition.validate(block));
  return { ok: errors.length === 0, errors };
}

export function validateContent(content) {
  const errors = [];
  if (!content || typeof content !== 'object') return { ok: false, errors: ['content must be object'] };
  if (!content.session || typeof content.session !== 'string') errors.push('session required string');
  if (!Number.isSafeInteger(content.round) || content.round < 1) errors.push('round must be integer >=1');
  if (content.meta != null) {
    if (typeof content.meta !== 'object' || Array.isArray(content.meta)) errors.push('meta must be object');
    else if (content.meta.docsUrl != null && typeof content.meta.docsUrl !== 'string') {
      errors.push('meta.docsUrl must be string');
    }
  }
  if (!Array.isArray(content.blocks)) errors.push('blocks must be array');
  else {
    const ids = new Set();
    content.blocks.forEach((b, i) => {
      const r = validateBlock(b);
      if (!r.ok) errors.push(`blocks[${i}]: ${r.errors.join('; ')}`);
      if (b && b.id) { if (ids.has(b.id)) errors.push(`duplicate block id: ${b.id}`); ids.add(b.id); }
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validateFeedback(fb) {
  const errors = [];
  if (!fb || typeof fb !== 'object') return { ok: false, errors: ['feedback must be object'] };
  if (!fb.session) errors.push('session required');
  if (!Number.isSafeInteger(fb.round) || fb.round < 1) errors.push('round required integer');
  // 会话级留言（iteration-brief P1）：不针对任何块的自由发言。可空；老消费者忽略即可
  if (fb.sessionComment != null && typeof fb.sessionComment !== 'string') errors.push('sessionComment must be string');
  if (!Array.isArray(fb.items)) errors.push('items must be array');
  else fb.items.forEach((it, i) => {
    if (!it || !it.blockId) errors.push(`items[${i}].blockId required`);
    if (it && it.type && !FEEDBACK_TYPES.includes(it.type)) errors.push(`items[${i}].type invalid: ${it.type}`);
  });
  if (fb.unanswered != null) {
    if (!Array.isArray(fb.unanswered)) errors.push('unanswered must be array');
    else fb.unanswered.forEach((blockId, i) => {
      if (typeof blockId !== 'string' || !blockId.trim()) errors.push(`unanswered[${i}] must be block id string`);
    });
  }
  return { ok: errors.length === 0, errors };
}
