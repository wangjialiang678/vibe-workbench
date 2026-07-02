// 内容协议 schema 与校验（DESIGN §2）。服务端用（含 node:crypto）。
import { createHash } from 'node:crypto';
import { BLOCK_TYPES, IMPORTANCE, IMPORTANCE_RANK, FEEDBACK_TYPES, STATES } from './constants.mjs';

export { BLOCK_TYPES, IMPORTANCE, IMPORTANCE_RANK, FEEDBACK_TYPES, STATES };

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
    options: block.options ?? null,
    recommendation: block.recommendation ?? null,
    default: block.default ?? null,
    value: block.value ?? null,
  };
  // §1.4 C：新 block 类型的核心字段加入指纹，否则 diff 对新类型失效
  if (block.type === 'prototype') {
    Object.assign(subset, {
      mode: block.mode ?? null,
      src: block.src ?? null,
      imageUrl: block.imageUrl ?? null,
      screen: block.screen ?? null,
    });
  }
  if (block.type === 'checklist') {
    Object.assign(subset, {
      items: block.items ?? null,
      verdictLabels: block.verdictLabels ?? null,
    });
  }
  return createHash('sha1').update(stableStringify(subset)).digest('hex');
}

export function validateBlock(block) {
  const errors = [];
  if (!block || typeof block !== 'object') return { ok: false, errors: ['block must be object'] };
  if (!block.id || typeof block.id !== 'string') errors.push('block.id required string');
  if (!BLOCK_TYPES.includes(block.type)) errors.push(`block.type invalid: ${block.type}`);
  if (block.importance != null && !IMPORTANCE.includes(block.importance)) errors.push(`importance invalid: ${block.importance}`);
  if (block.needsDecision != null && typeof block.needsDecision !== 'boolean') errors.push('needsDecision must be boolean');
  if (block.hasRecommendation != null && typeof block.hasRecommendation !== 'boolean') errors.push('hasRecommendation must be boolean');
  if (block.type === 'choice') {
    if (!Array.isArray(block.options) || block.options.length === 0) errors.push('choice requires non-empty options[]');
    else block.options.forEach((o, i) => { if (!o || !o.id) errors.push(`choice option[${i}] requires id`); });
    if (block.hasRecommendation && block.recommendation != null) {
      const ids = (block.options || []).map((o) => o && o.id);
      if (!ids.includes(block.recommendation)) errors.push('choice.recommendation must match an option id');
    }
  }
  if (block.type === 'table') {
    if (!Array.isArray(block.columns)) errors.push('table requires columns[]');
    if (!Array.isArray(block.rows)) errors.push('table requires rows[]');
  }
  if (block.type === 'embed') {
    if (!block.url || typeof block.url !== 'string') errors.push('embed requires non-empty url string');
  }
  if (block.type === 'prototype') {
    const validModes = ['wireframe', 'iframe', 'image'];
    if (!validModes.includes(block.mode)) errors.push(`prototype.mode must be one of: ${validModes.join(', ')}`);
    if (block.mode === 'iframe' && (!block.src || typeof block.src !== 'string')) {
      errors.push('prototype with mode=iframe requires non-empty src string');
    }
    if (block.mode === 'image' && (!block.imageUrl || typeof block.imageUrl !== 'string')) {
      errors.push('prototype with mode=image requires non-empty imageUrl string');
    }
    if (block.mode === 'wireframe' && (!block.screen || typeof block.screen !== 'object')) {
      errors.push('prototype with mode=wireframe requires screen object');
    }
  }
  if (block.type === 'checklist') {
    if (!Array.isArray(block.items) || block.items.length === 0) {
      errors.push('checklist requires non-empty items[]');
    } else {
      block.items.forEach((item, i) => {
        if (!item || !item.id) errors.push(`checklist items[${i}] requires id`);
        if (!item || !item.label) errors.push(`checklist items[${i}] requires label`);
      });
    }
    if (!Array.isArray(block.verdictLabels) || block.verdictLabels.length === 0) {
      errors.push('checklist requires non-empty verdictLabels[]');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateContent(content) {
  const errors = [];
  if (!content || typeof content !== 'object') return { ok: false, errors: ['content must be object'] };
  if (!content.session || typeof content.session !== 'string') errors.push('session required string');
  if (!Number.isInteger(content.round) || content.round < 1) errors.push('round must be integer >=1');
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
  if (!Number.isInteger(fb.round)) errors.push('round required integer');
  if (!Array.isArray(fb.items)) errors.push('items must be array');
  else fb.items.forEach((it, i) => {
    if (!it || !it.blockId) errors.push(`items[${i}].blockId required`);
    if (it && it.type && !FEEDBACK_TYPES.includes(it.type)) errors.push(`items[${i}].type invalid: ${it.type}`);
  });
  return { ok: errors.length === 0, errors };
}
