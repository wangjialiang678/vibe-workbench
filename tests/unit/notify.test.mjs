import test from 'node:test';
import assert from 'node:assert/strict';

import { WEBHOOK_TIMEOUT_MS, inboxTaskTitle, postWebhookEvent } from '../../src/server/notify.mjs';

test('notify：事件标题保持既有文案', () => {
  assert.equal(inboxTaskTitle({ event: 'round-presented', round: 2, title: '评审' }), '第 2 轮已呈现：评审');
  assert.equal(inboxTaskTitle({ event: 'feedback-submitted', round: 3 }), '第 3 轮反馈已提交');
  assert.equal(inboxTaskTitle({ event: 'message-posted' }), '会话新消息');
  assert.equal(inboxTaskTitle({ event: 'other' }), '会话事件：other');
});

test('notify：webhook 使用 JSON POST，失败被吞掉并记录日志', async () => {
  const calls = [];
  const errors = [];
  await postWebhookEvent('https://example.test/events', { event: 'round-presented' }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, body: { cancel: async () => {} } };
    },
    logger: { error: (...args) => errors.push(args) },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.body, '{"event":"round-presented"}');
  assert.deepEqual(errors, []);
  assert.equal(WEBHOOK_TIMEOUT_MS, 5000);

  await postWebhookEvent('https://example.test/events', {}, {
    fetchImpl: async () => { throw new Error('offline'); },
    logger: { error: (...args) => errors.push(args) },
  });
  assert.match(errors[0][1], /offline/);
});
