import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFingerprint, validateBlock } from '../../src/protocol/schema.mjs';
import { lintBlock } from '../../src/protocol/lint.mjs';
import { BLOCK_TYPES, getBlockType, registerBlockType, unregisterBlockType } from '../../src/protocol/block-types/index.mjs';
import { blockHtml } from '../../src/render/blocks.mjs';

test('虚构 block 类型只注册一个清单即可走校验、渲染与内容哈希', () => {
  const type = 'virtual-registry-proof';
  const definition = {
    type,
    hashFields: ['message'],
    validate(block) { return typeof block.message === 'string' ? [] : ['virtual requires message string']; },
    render(block, { escHtml }) { return `<p class="virtual-block">${escHtml(block.message)}</p>`; },
    lint(block) { return block.message === 'warn' ? [{ rule: 'virtual-warning', message: '虚构类型告警' }] : []; },
  };
  registerBlockType(definition);
  try {
    assert.equal(getBlockType(type), definition);
    assert.ok(BLOCK_TYPES.includes(type));
    assert.deepEqual(validateBlock({ id: 'virtual', type, message: 'ok' }), { ok: true, errors: [] });
    assert.deepEqual(validateBlock({ id: 'virtual', type }), { ok: false, errors: ['virtual requires message string'] });
    assert.match(blockHtml({ id: 'virtual', type, message: '<safe>' }), /<p class="virtual-block">&lt;safe&gt;<\/p>/);
    assert.notEqual(
      blockFingerprint({ id: 'virtual', type, message: 'one' }),
      blockFingerprint({ id: 'virtual', type, message: 'two' }),
    );
    assert.deepEqual(lintBlock({ id: 'virtual', type, message: 'warn' }).map((warning) => warning.rule), ['virtual-warning']);
  } finally {
    unregisterBlockType(type);
  }
  assert.equal(getBlockType(type), undefined);
  assert.equal(BLOCK_TYPES.includes(type), false);
});
