import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendStreamEntry,
  migrateSessionComments,
  readStreamEntries,
  streamPath,
} from '../../src/stream.mjs';

let tmp;
let previousWorkspace;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-stream-'));
  previousWorkspace = process.env.WB_WORKSPACE;
  process.env.WB_WORKSPACE = tmp;
});

after(() => {
  if (previousWorkspace === undefined) delete process.env.WB_WORKSPACE;
  else process.env.WB_WORKSPACE = previousWorkspace;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const owner = { id: 'owner', name: '管理员', role: 'owner' };
const ai = { id: 'ai', name: 'AI', role: 'ai' };

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function appendAt(session, index, overrides = {}, options) {
  return appendStreamEntry(session, {
    id: uuid(index),
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    author: owner,
    kind: 'message',
    text: `第 ${index} 条`,
    ...overrides,
  }, options);
}

function writeFeedback(session, round, feedback, fileName = 'feedback.json') {
  const file = path.join(tmp, session, `round-${round}`, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(feedback, null, 2), 'utf8');
}

test('appendStreamEntry：按追加顺序写入 JSONL，并返回完整条目结构', () => {
  const session = 'append-order';
  const first = appendStreamEntry(session, {
    author: owner,
    kind: 'message',
    text: '先写入的消息',
    refs: { round: 2, blockId: 'decision-a' },
  });
  const second = appendStreamEntry(session, {
    id: uuid(2),
    at: '2026-07-23T01:02:04.000Z',
    author: ai,
    kind: 'receipt',
    text: '后写入的回执',
  });

  assert.deepEqual(first, {
    id: first.id,
    at: first.at,
    author: owner,
    kind: 'message',
    text: '先写入的消息',
    refs: { round: 2, blockId: 'decision-a' },
  });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(Number.isNaN(Date.parse(first.at)), false);
  assert.deepEqual(second, {
    id: uuid(2),
    at: '2026-07-23T01:02:04.000Z',
    author: ai,
    kind: 'receipt',
    text: '后写入的回执',
  });

  const raw = fs.readFileSync(streamPath(session), 'utf8');
  assert.equal(raw.endsWith('\n'), true, '每条 JSON 后应保留换行，便于继续追加');
  assert.deepEqual(
    raw.trimEnd().split('\n').map((line) => JSON.parse(line)),
    [first, second],
  );
});

test('readStreamEntries：默认只返回最近 100 条，limit 可缩小尾部窗口', () => {
  const session = 'recent-window';
  for (let index = 0; index < 105; index += 1) appendAt(session, index);

  const recent = readStreamEntries(session);
  assert.equal(recent.length, 100);
  assert.equal(recent[0].id, uuid(5));
  assert.equal(recent.at(-1).id, uuid(104));
  assert.deepEqual(
    readStreamEntries(session, { limit: 2 }).map((entry) => entry.id),
    [uuid(103), uuid(104)],
  );
});

test('readStreamEntries：since 命中 ID 时只返回该条目之后的内容', () => {
  const session = 'since-id';
  appendAt(session, 1);
  appendAt(session, 2);
  appendAt(session, 3);

  assert.deepEqual(
    readStreamEntries(session, { since: uuid(2) }).map((entry) => entry.id),
    [uuid(3)],
  );
});

test('readStreamEntries：since 为 ISO 时间时只返回时间严格更晚的内容', () => {
  const session = 'since-time';
  appendAt(session, 1, { at: '2026-07-23T08:00:00.000Z' });
  appendAt(session, 2, { at: '2026-07-23T08:00:01.000Z' });
  appendAt(session, 3, { at: '2026-07-23T08:00:02.000Z' });

  assert.deepEqual(
    readStreamEntries(session, { since: '2026-07-23T08:00:01.000Z' })
      .map((entry) => entry.id),
    [uuid(3)],
  );
});

test('点号 session：exactSession 使用原名目录读写 stream.jsonl', () => {
  const session = 'shared.round-1';
  const expected = path.join(tmp, session, 'stream.jsonl');

  assert.equal(streamPath(session, { exactSession: true }), expected);
  const written = appendAt(session, 1, {}, { exactSession: true });
  assert.equal(fs.existsSync(expected), true);
  assert.equal(fs.existsSync(path.join(tmp, 'shared_round-1', 'stream.jsonl')), false);
  assert.deepEqual(readStreamEntries(session, { exactSession: true }), [written]);
});

test('流数据层拒绝非法 session、author、kind 与空白文本', () => {
  const valid = {
    id: uuid(1),
    at: '2026-07-23T00:00:00.000Z',
    author: owner,
    kind: 'message',
    text: '有效消息',
  };

  for (const session of ['', '.', '..', '../escape', '含中文']) {
    assert.throws(() => appendStreamEntry(session, valid), /session|会话/i);
  }
  assert.throws(() => streamPath('../escape'), /session|会话/i);
  assert.throws(() => readStreamEntries('../escape'), /session|会话/i);

  for (const author of [
    null,
    { id: '', name: '管理员', role: 'owner' },
    { id: 'owner', name: '', role: 'owner' },
    { id: 'owner', name: '管理员', role: 'system' },
  ]) {
    assert.throws(
      () => appendStreamEntry('invalid-author', { ...valid, author }),
      /author|作者/i,
    );
  }

  assert.throws(
    () => appendStreamEntry('invalid-kind', { ...valid, kind: 'comment' }),
    /kind|类型/i,
  );
  for (const text of ['', '   ', '\n\t']) {
    assert.throws(
      () => appendStreamEntry('empty-text', { ...valid, text }),
      /text|文本|内容/i,
    );
  }
});

test('migrateSessionComments：迁移规范反馈留言并保留作者、时间与轮次引用', () => {
  const session = 'migration.rounds';
  const submittedBy = { id: 'alice', name: '小艾' };
  writeFeedback(session, 1, {
    session,
    round: 1,
    submittedAt: '2026-07-20T01:00:00.000Z',
    submittedBy,
    sessionComment: '请把总体方案再收紧一些。',
    items: [],
  });
  // 旧反馈没有 submittedBy，迁移时应明确归到管理员。
  writeFeedback(session, 2, {
    session,
    round: 2,
    submittedAt: '2026-07-21T02:00:00.000Z',
    sessionComment: '这是旧版管理员留言。',
    items: [],
  });
  // 空白留言不产生流条目。
  writeFeedback(session, 3, {
    session,
    round: 3,
    submittedAt: '2026-07-22T03:00:00.000Z',
    sessionComment: ' \n ',
    items: [],
  });
  // 非规范的逐人反馈文件不在本次迁移范围内。
  writeFeedback(session, 4, {
    session,
    round: 4,
    submittedAt: '2026-07-23T04:00:00.000Z',
    submittedBy: { id: 'bob', name: '小波' },
    sessionComment: '不应从 feedback-bob.json 迁移。',
    items: [],
  }, 'feedback-bob.json');

  const first = migrateSessionComments(session);
  assert.equal(first.migrated, 2);

  const entries = readStreamEntries(session, { exactSession: true });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(({ id, ...entry }) => entry), [
    {
      at: '2026-07-20T01:00:00.000Z',
      author: { ...submittedBy, role: 'participant' },
      kind: 'message',
      text: '请把总体方案再收紧一些。',
      refs: { round: 1 },
    },
    {
      at: '2026-07-21T02:00:00.000Z',
      author: owner,
      kind: 'message',
      text: '这是旧版管理员留言。',
      refs: { round: 2 },
    },
  ]);
  assert.equal(entries.every((entry) => typeof entry.id === 'string' && entry.id.length > 0), true);
  assert.notEqual(entries[0].id, entries[1].id);

  const second = migrateSessionComments(session);
  assert.equal(second.migrated, 0);
  assert.deepEqual(readStreamEntries(session, { exactSession: true }), entries);
});
