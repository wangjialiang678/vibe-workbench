import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addParticipant,
  listParticipants,
  readParticipants,
  revokeParticipant,
} from '../../src/participants.mjs';

function withRoster(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-participants-'));
  const filePath = path.join(dir, 'config', 'participants.json');
  try { return run(filePath); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('参与者名册：不存在时为空，add 写入随机 token 与 createdAt', () => withRoster((filePath) => {
  assert.deepEqual(readParticipants(filePath), []);

  const participant = addParticipant({ id: 'alice', name: '小艾' }, { filePath });

  assert.equal(participant.id, 'alice');
  assert.equal(participant.name, '小艾');
  assert.match(participant.token, /^[a-f0-9]{32}$/);
  assert.equal(Number.isNaN(Date.parse(participant.createdAt)), false);
  assert.deepEqual(readParticipants(filePath), [participant]);
  assert.equal(fs.readdirSync(path.dirname(filePath)).some((name) => name.includes('.tmp')), false);
}));

test('参与者名册：list 永不返回 token，重复/非法 id 被拒绝', () => withRoster((filePath) => {
  addParticipant({ id: 'alice', name: '小艾' }, { filePath });

  assert.deepEqual(listParticipants(filePath), [{
    id: 'alice',
    name: '小艾',
    createdAt: readParticipants(filePath)[0].createdAt,
  }]);
  assert.equal(JSON.stringify(listParticipants(filePath)).includes('token'), false);
  assert.throws(() => addParticipant({ id: 'alice', name: '重复' }, { filePath }), /已存在/);
  assert.throws(() => addParticipant({ id: '../escape', name: '非法' }, { filePath }), /id/);
  assert.throws(() => addParticipant({ id: 'owner', name: '冒充管理员' }, { filePath }), /保留/);
  assert.throws(() => addParticipant({ id: 'bob', name: '   ' }, { filePath }), /name|名字/);
}));

test('参与者名册：revoke 删除条目且再次吊销返回 false', () => withRoster((filePath) => {
  const alice = addParticipant({ id: 'alice', name: '小艾' }, { filePath });
  addParticipant({ id: 'bob', name: '小波' }, { filePath });

  assert.equal(revokeParticipant('alice', { filePath }), true);
  assert.equal(readParticipants(filePath).some((item) => item.token === alice.token), false);
  assert.deepEqual(listParticipants(filePath).map((item) => item.id), ['bob']);
  assert.equal(revokeParticipant('alice', { filePath }), false);
}));

test('参与者名册：损坏 JSON 显式报错，管理写不会静默覆盖', () => withRoster((filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{broken', 'utf8');

  assert.throws(() => readParticipants(filePath), /名册|JSON|损坏/);
  assert.throws(() => addParticipant({ id: 'alice', name: '小艾' }, { filePath }), /名册|JSON|损坏/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
}));
