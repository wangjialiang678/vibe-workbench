import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { validateBlock } from '../../src/protocol/schema.mjs';
import { paths, readJSON, writeJSON, writeStatus } from '../../src/workspace.mjs';
import { startServer } from '../../src/server/server.mjs';
import { revokeParticipant } from '../../src/participants.mjs';

const OWNER_TOKEN = 'owner-visibility-token';
const PARTICIPANTS = [
  { id: 'alice', name: '小艾', token: 'alice-visibility-token', createdAt: '2026-07-25T00:00:00.000Z' },
  { id: 'bob', name: '小波', token: 'bob-visibility-token', createdAt: '2026-07-25T00:00:01.000Z' },
];

let server;
let baseUrl;
let workspace;
let participantsFile;
const savedEnv = {};

before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-block-visibility-'));
  participantsFile = path.join(workspace, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, JSON.stringify(PARTICIPANTS, null, 2));

  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN']) savedEnv[key] = process.env[key];
  process.env.WB_WORKSPACE = workspace;
  process.env.WORKBENCH_TOKEN = OWNER_TOKEN;

  server = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN']) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function contentFor(session, blocks, round = 1, prevRound = round > 1 ? round - 1 : 0) {
  writeJSON(paths.content(session, round, { exactSession: true }), {
    session,
    round,
    prevRound,
    blocks,
  });
  writeStatus(session, { state: 'rendered', round }, undefined, { exactSession: true });
}

async function getContent(session, token = OWNER_TOKEN, round = 1) {
  const response = await fetch(`${baseUrl}/api/content?session=${session}&round=${round}`, {
    headers: { 'x-workbench-token': token },
  });
  return { response, body: await response.json() };
}

async function postFeedback(session, token, items, round = 1, extra = {}) {
  const response = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-workbench-token': token,
    },
    body: JSON.stringify({ session, round, items, ...extra }),
  });
  return { response, body: await response.json() };
}

test('validateBlock：assignee 省略、null、空串和非空字符串均按契约处理', () => {
  assert.equal(validateBlock({ id: 'public', type: 'markdown' }).ok, true);
  assert.equal(validateBlock({ id: 'null', type: 'markdown', assignee: null }).ok, true);
  assert.equal(validateBlock({ id: 'empty', type: 'markdown', assignee: '' }).ok, true);
  assert.equal(validateBlock({ id: 'alice', type: 'markdown', assignee: 'alice' }).ok, true);
});

test('validateBlock：assignee 有值时拒绝非字符串和空白字符串', () => {
  for (const assignee of [42, true, {}, [], '   ']) {
    const result = validateBlock({ id: 'invalid', type: 'markdown', assignee });
    assert.equal(result.ok, false, `assignee=${JSON.stringify(assignee)} 应被拒绝`);
    assert.ok(result.errors.some((error) => error.includes('assignee')));
  }
});

test('owner 看到全部块', async () => {
  const session = 'visibility-owner';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'alice-only', type: 'markdown', body: '给小艾的内容', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await getContent(session);
  assert.equal(response.status, 200);
  assert.deepEqual(body.blocks.map((block) => block.id), ['public', 'alice-only', 'bob-only']);
});

test('participant 只看到公共块和指派给自己的块', async () => {
  const session = 'visibility-alice';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'alice-only', type: 'markdown', body: '给小艾的内容', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await getContent(session, 'alice-visibility-token');
  assert.equal(response.status, 200);
  assert.deepEqual(body.blocks.map((block) => block.id), ['public', 'alice-only']);
  assert.doesNotMatch(JSON.stringify(body), /给小波的内容/);
});

test('participant 看不到指派给别人的块', async () => {
  const session = 'visibility-bob';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'alice-only', type: 'markdown', body: '给小艾的秘密', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await getContent(session, 'bob-visibility-token');
  assert.equal(response.status, 200);
  assert.deepEqual(body.blocks.map((block) => block.id), ['public', 'bob-only']);
  assert.doesNotMatch(JSON.stringify(body), /alice-only|给小艾的秘密/);
});

test('participant 对不可见块提交反馈被拒绝', async () => {
  const session = 'visibility-write';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await postFeedback(session, 'alice-visibility-token', [
    { blockId: 'bob-only', type: 'select', value: 'reject' },
  ]);
  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.match(body.error, /不可见|不可访问|visibility/i);
  assert.equal(fs.existsSync(paths.participantFeedback(session, 1, 'alice', { exactSession: true })), false);
  assert.equal(readJSON(paths.status(session, { exactSession: true })).state, 'rendered');
});

test('老内容无 assignee 字段时所有人可见', async () => {
  const session = 'visibility-legacy';
  contentFor(session, [
    { id: 'legacy-a', type: 'markdown', body: '旧内容 A' },
    { id: 'legacy-b', type: 'markdown', body: '旧内容 B' },
  ]);

  const owner = await getContent(session, OWNER_TOKEN);
  const alice = await getContent(session, 'alice-visibility-token');
  assert.deepEqual(owner.body.blocks.map((block) => block.id), ['legacy-a', 'legacy-b']);
  assert.deepEqual(alice.body.blocks.map((block) => block.id), ['legacy-a', 'legacy-b']);
});

test('只读互见：甲可见块上乙的意见仍然显示，隐藏块意见不泄漏', async () => {
  const session = 'visibility-cross-feedback';
  contentFor(session, [
    { id: 'shared', type: 'markdown', body: '甲乙都可见' },
    { id: 'alice-only', type: 'markdown', body: '甲可见', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '乙可见', assignee: 'bob' },
  ]);

  assert.equal((await postFeedback(session, 'alice-visibility-token', [
    { blockId: 'shared', type: 'select', value: 'alice-choice' },
    { blockId: 'alice-only', type: 'text', value: '甲的意见' },
  ])).response.status, 200);
  assert.equal((await postFeedback(session, 'bob-visibility-token', [
    { blockId: 'shared', type: 'select', value: 'bob-choice' },
    { blockId: 'bob-only', type: 'text', value: '乙的私有意见' },
  ])).response.status, 200);

  const response = await fetch(`${baseUrl}/api/feedback?session=${session}&round=1`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const bob = body.byParticipant.find((entry) => entry.id === 'bob');
  assert.ok(bob);
  assert.deepEqual(bob.feedback.items.map((item) => item.blockId), ['shared']);
  assert.equal(bob.feedback.items[0].value, 'bob-choice');
  assert.deepEqual(body.conflicts, [{
    blockId: 'shared',
    choices: [
      { participant: '小艾', value: 'alice-choice' },
      { participant: '小波', value: 'bob-choice' },
    ],
  }]);
});

test('跨轮可见性收紧时 removed 不泄漏旧 block，assignee 变化也不是 unchanged', async () => {
  const cases = [
    {
      name: 'public-to-bob',
      viewer: 'alice-visibility-token',
      previousAssignee: null,
      currentAssignee: 'bob',
      currentBody: '当前只给小波',
      previousBody: '上一轮公共秘密',
      expectedCurrentIds: [],
    },
    {
      name: 'alice-to-bob',
      viewer: 'alice-visibility-token',
      previousAssignee: 'alice',
      currentAssignee: 'bob',
      currentBody: '当前只给小波',
      previousBody: '上一轮给小艾的秘密',
      expectedCurrentIds: [],
    },
    {
      name: 'bob-to-alice',
      viewer: 'alice-visibility-token',
      previousAssignee: 'bob',
      currentAssignee: 'alice',
      currentBody: '当前给小艾',
      previousBody: '上一轮给小波的秘密',
      expectedCurrentIds: ['transition'],
    },
  ];

  for (const item of cases) {
    const session = `removed-${item.name}`;
    contentFor(session, [{
      id: 'transition',
      type: 'markdown',
      body: item.previousBody,
      ...(item.previousAssignee == null ? {} : { assignee: item.previousAssignee }),
    }], 1);
    contentFor(session, [{
      id: 'transition',
      type: 'markdown',
      body: item.currentBody,
      ...(item.currentAssignee == null ? {} : { assignee: item.currentAssignee }),
    }], 2);

    const { response, body } = await getContent(session, item.viewer, 2);
    assert.equal(response.status, 200, item.name);
    assert.deepEqual(body.blocks.map((block) => block.id), item.expectedCurrentIds, item.name);
    assert.deepEqual(body.removed, [], item.name);
    assert.doesNotMatch(JSON.stringify(body), /上一轮.*秘密/, item.name);

    if (item.name === 'public-to-bob') {
      const bob = await getContent(session, 'bob-visibility-token', 2);
      assert.equal(bob.response.status, 200);
      assert.equal(bob.body.blocks[0]._change, 'changed', 'assignee 变化必须进入 block fingerprint');
    }
  }
});

test('跨轮生成上一轮响应标记前会过滤当前身份不可见的上一轮 feedback', async () => {
  const session = 'responded-prev-visibility';
  contentFor(session, [{
    id: 'secret',
    type: 'markdown',
    body: '上一轮只给小波',
    assignee: 'bob',
  }], 1);
  writeJSON(paths.feedback(session, 1, { exactSession: true }), {
    session,
    round: 1,
    items: [{ blockId: 'secret', type: 'text', value: '小波的反馈' }],
    submittedBy: { id: 'owner', name: '管理员' },
  });
  contentFor(session, [{
    id: 'secret',
    type: 'markdown',
    body: '当前给小艾',
    assignee: 'alice',
  }], 2);

  const { response, body } = await getContent(session, 'alice-visibility-token', 2);
  assert.equal(response.status, 200);
  assert.equal(body.blocks.length, 1);
  assert.equal(Object.hasOwn(body.blocks[0], '_respondedToPrev'), false);
  assert.equal(Object.hasOwn(body.blocks[0], '_decidedInPrev'), false);
});

test('参与者资产清单和直读只允许可见 block 可达资产，公共引用可放行共享资产', async () => {
  const session = 'asset-block-visibility';
  const assetRoot = path.join(workspace, session, 'assets');
  const files = {
    public: 'public/page.html',
    shared: 'shared/common.html',
    privatePrototype: 'private/prototype.html',
    privateImage: 'private/screen.png',
    privatePdf: 'private/report.pdf',
    privateEmbed: 'private/embed.html',
  };
  for (const [key, relativePath] of Object.entries(files)) {
    const target = path.join(assetRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `asset-${key}`);
  }
  const asset = (relativePath) => `/assets/${session}/${relativePath}`;
  contentFor(session, [
    { id: 'public', type: 'markdown', body: `公共页面 ${asset(files.public)} ${asset(files.shared)}` },
    { id: 'private-prototype', type: 'prototype', mode: 'iframe', src: asset(files.privatePrototype), assignee: 'bob' },
    { id: 'private-image', type: 'prototype', mode: 'image', imageUrl: asset(files.privateImage), assignee: 'bob' },
    { id: 'private-pdf', type: 'markdown', body: `[私有 PDF](${asset(files.privatePdf)})`, assignee: 'bob' },
    { id: 'private-embed', type: 'embed', url: asset(files.privateEmbed), assignee: 'bob' },
    { id: 'private-shared', type: 'markdown', body: `私有块也引用 ${asset(files.shared)}`, assignee: 'bob' },
  ]);

  const inventory = await fetch(`${baseUrl}/api/assets?session=${session}`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(inventory.status, 200);
  const inventoryBody = await inventory.json();
  assert.deepEqual(inventoryBody.files.map((file) => file.path), [files.public, files.shared]);

  const readAsset = (relativePath) => fetch(`${baseUrl}${asset(relativePath)}?token=alice-visibility-token`);
  const publicResponse = await readAsset(files.public);
  assert.equal(publicResponse.status, 200);
  assert.equal(await publicResponse.text(), 'asset-public');
  const sharedResponse = await readAsset(files.shared);
  assert.equal(sharedResponse.status, 200, '公共块引用的共享资产应放行');

  for (const relativePath of [files.privatePrototype, files.privateImage, files.privatePdf, files.privateEmbed]) {
    const response = await readAsset(relativePath);
    assert.equal(response.status, 403, relativePath);
  }
});

test('资产引用只接受同源或本地绝对路径，覆盖外部 URL 子串、编码、Markdown、HTML、CSS 和 srcdoc', async () => {
  const session = 'asset-reference-boundary';
  const publicPaths = [
    'public/plain.txt',
    'public/encoded.name.txt',
    'public/markdown.png',
    'public/html-double.html',
    'public/html-single.html',
    'public/css.png',
    'public/srcdoc.png',
    'public/same-origin.txt',
  ];
  const deniedPaths = [
    'private/external-collision.txt',
    'private/relative.txt',
    'private/encoded-prefix.txt',
  ];
  for (const relativePath of [...publicPaths, ...deniedPaths]) {
    const target = path.join(workspace, session, 'assets', relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `asset-${relativePath}`);
  }

  const asset = (relativePath) => `/assets/${session}/${relativePath}`;
  const sameOriginAsset = `${baseUrl}${asset('public/same-origin.txt')}`;
  contentFor(session, [{
    id: 'public-references',
    type: 'markdown',
    body: [
      `外部碰撞：https://cdn.example${asset('private/external-collision.txt')}`,
      `相对路径：assets/${session}/private/relative.txt`,
      `普通本地路径：${asset('public/plain.txt')}`,
      `编码路径：${asset('public/encoded%2Ename.txt')}`,
      `Markdown：![预览](${asset('public/markdown.png')})`,
      `<img src="${asset('public/html-double.html')}">`,
      `<img src='${asset('public/html-single.html')}'>`,
      `<style>.hero { background: url('${asset('public/css.png')}'); }</style>`,
      `<iframe srcdoc="<img src='${asset('public/srcdoc.png')}'>"></iframe>`,
      `同源完整 URL：${sameOriginAsset}`,
      `编码前缀：/%61ssets/${session}/private/encoded-prefix.txt`,
    ].join('\n'),
  }]);

  const inventory = await fetch(`${baseUrl}/api/assets?session=${session}`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(inventory.status, 200);
  const inventoryBody = await inventory.json();
  const expectedPaths = [...publicPaths].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  assert.deepEqual(inventoryBody.files.map((file) => file.path), expectedPaths);

  for (const relativePath of publicPaths) {
    const response = await fetch(`${baseUrl}${asset(relativePath)}?token=alice-visibility-token`);
    assert.equal(response.status, 200, relativePath);
  }
  for (const relativePath of deniedPaths) {
    const response = await fetch(`${baseUrl}${asset(relativePath)}?token=alice-visibility-token`);
    assert.equal(response.status, 403, relativePath);
  }

  // 真实 HTTP 请求验证 manifest 和递归清单缓存会在内容/资产版本变化后失效。
  const latePath = 'public/added-after-cache.txt';
  const lateTarget = path.join(workspace, session, 'assets', latePath);
  fs.writeFileSync(lateTarget, 'asset-added-after-cache');
  contentFor(session, [{
    id: 'public-references',
    type: 'markdown',
    body: sameOriginAsset + ' /assets/' + session + '/' + latePath,
  }]);
  const refreshed = await fetch(baseUrl + '/api/assets?session=' + session, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(refreshed.status, 200);
  assert.deepEqual((await refreshed.json()).files.map((file) => file.path), [
    'public/added-after-cache.txt',
    'public/same-origin.txt',
  ]);
  const lateRead = await fetch(baseUrl + asset(latePath) + '?token=alice-visibility-token');
  assert.equal(lateRead.status, 200);
});

test('资产目录拒绝会话内 symlink、外部 symlink 和中间组件 symlink', async () => {
  const session = 'asset-symlink-boundary';
  const assetRoot = path.join(workspace, session, 'assets');
  const privateDir = path.join(assetRoot, 'private');
  const publicDir = path.join(assetRoot, 'public');
  fs.mkdirSync(privateDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(privateDir, 'secret.txt'), 'SYMLINK-PRIVATE-SECRET');
  const outside = path.join(workspace, 'outside-symlink-secret.txt');
  fs.writeFileSync(outside, 'SYMLINK-OUTSIDE-SECRET');
  fs.symlinkSync('../private/secret.txt', path.join(publicDir, 'link-private.txt'));
  fs.symlinkSync(outside, path.join(publicDir, 'link-outside.txt'));
  fs.symlinkSync('../private', path.join(publicDir, 'link-dir'));

  contentFor(session, [{
    id: 'public-links',
    type: 'markdown',
    body: [
      `/assets/${session}/public/link-private.txt`,
      `/assets/${session}/public/link-outside.txt`,
      `/assets/${session}/public/link-dir/secret.txt`,
    ].join(' '),
  }]);

  for (const relativePath of [
    'public/link-private.txt',
    'public/link-outside.txt',
    'public/link-dir/secret.txt',
  ]) {
    const response = await fetch(`${baseUrl}/assets/${session}/${relativePath}?token=alice-visibility-token`);
    assert.notEqual(response.status, 200, relativePath);
    assert.doesNotMatch(await response.text(), /SYMLINK-(?:PRIVATE|OUTSIDE)-SECRET/);
  }
});

test('资产授权只取当前轮，显式请求旧轮时只取该轮；内容改写会使缓存授权失效', async () => {
  const session = 'asset-round-boundary';
  const assetRoot = path.join(workspace, session, 'assets');
  fs.mkdirSync(path.join(assetRoot, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(assetRoot, 'ui', 'old-only.html'), 'OLD-ROUND-PUBLIC');
  fs.writeFileSync(path.join(assetRoot, 'ui', 'same.html'), 'PUBLIC-V1');

  contentFor(session, [{
    id: 'round-one-public',
    type: 'markdown',
    body: `/assets/${session}/ui/old-only.html /assets/${session}/ui/same.html`,
  }], 1, 0);
  contentFor(session, [{
    id: 'round-two-private',
    type: 'markdown',
    body: `/assets/${session}/ui/same.html`,
    assignee: 'bob',
  }], 2, 1);
  fs.writeFileSync(path.join(assetRoot, 'ui', 'same.html'), 'SECRET-V2-WRITTEN-AFTER-REASSIGN');

  const current = await fetch(`${baseUrl}/api/assets?session=${session}`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(current.status, 200);
  assert.deepEqual((await current.json()).files, []);

  const currentRead = await fetch(`${baseUrl}/assets/${session}/ui/same.html?token=alice-visibility-token`);
  assert.equal(currentRead.status, 403);

  const oldRound = await fetch(`${baseUrl}/api/assets?session=${session}&round=1`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(oldRound.status, 200);
  assert.deepEqual((await oldRound.json()).files.map((file) => file.path), [
    'ui/old-only.html',
    'ui/same.html',
  ]);
  const oldOnlyRead = await fetch(`${baseUrl}/assets/${session}/ui/old-only.html?token=alice-visibility-token&round=1`);
  assert.equal(oldOnlyRead.status, 200);
  assert.equal(await oldOnlyRead.text(), 'OLD-ROUND-PUBLIC');
});

test('畸形百分号路径只返回 4xx，资产和静态路由都不让 HTTP server 退出', async () => {
  const serverModule = new URL('../../src/server/server.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', [
    `import { startServer } from ${JSON.stringify(serverModule)};`,
    "const server = startServer(0, '127.0.0.1');",
    "server.once('listening', () => process.stdout.write(String(server.address().port) + '\\n'));",
  ].join('\n')], {
    env: { ...process.env, WB_WORKSPACE: workspace, WORKBENCH_TOKEN: OWNER_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const port = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk.toString();
      const line = output.split('\n')[0].trim();
      if (line) resolve(Number(line));
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`probe server exited: ${code}/${signal}`)));
  });
  const probeBase = `http://127.0.0.1:${port}`;
  try {
    for (const pathname of [
      '/assets/no-session/%ZZ',
      '/assets/no-session/%',
      '/assets/no-session/%E0%A4%A',
      `/assets/no-session/${'a'.repeat(8000)}`,
      '/render/%ZZ',
    ]) {
      const response = await fetch(`${probeBase}${pathname}?token=${OWNER_TOKEN}`);
      assert.ok(response.status >= 400 && response.status < 500, `${pathname}: ${response.status}`);
      const health = await fetch(`${probeBase}/api/health?token=${OWNER_TOKEN}`);
      assert.equal(health.status, 200, `${pathname} 后 server 应存活`);
      assert.equal((await health.json()).ok, true);
    }
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode == null && child.signalCode == null) await once(child, 'exit');
  }
});

test('参与者读取 stream 会过滤隐藏/未知 block ref，隐藏 ask 及其 answer 均不可访问', async () => {
  const session = 'stream-block-visibility';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共块' },
    { id: 'bob-only', type: 'markdown', body: '小波私有块', assignee: 'bob' },
  ]);
  const postStreamEvent = (body, token = OWNER_TOKEN) => fetch(`${baseUrl}/api/stream-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-workbench-token': token },
    body: JSON.stringify({ session, ...body }),
  });
  const ask = {
    id: 'hidden-ask',
    question: '私有决策',
    options: [
      { id: 'a', label: '方案 A', desc: '代价 A' },
      { id: 'b', label: '方案 B', desc: '代价 B' },
    ],
    multi: false,
  };
  const hiddenSecrets = {
    message: 'UNIQUE-HIDDEN-STREAM-MESSAGE-SECRET',
    progress: 'UNIQUE-HIDDEN-STREAM-PROGRESS-SECRET',
    receipt: 'UNIQUE-HIDDEN-STREAM-RECEIPT-SECRET',
  };
  const unknownSecret = 'UNIQUE-UNKNOWN-STREAM-MESSAGE-SECRET';
  for (const body of [
    { kind: 'message', text: '公共引用', refs: { round: 1, blockId: 'public' } },
    ...Object.entries(hiddenSecrets).map(([kind, text]) => ({
      kind,
      text,
      refs: { round: 1, blockId: 'bob-only' },
    })),
    { kind: 'message', text: unknownSecret, refs: { round: 1, blockId: 'missing-block' } },
  ]) {
    const response = await postStreamEvent(body);
    assert.equal(response.status, 200);
  }
  const askResponse = await postStreamEvent({ kind: 'ask', text: ask.question, ask, refs: { round: 1, blockId: 'bob-only' } });
  assert.equal(askResponse.status, 200);

  const messages = await fetch(`${baseUrl}/api/messages?session=${session}`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(messages.status, 200);
  const entries = (await messages.json()).entries;
  assert.equal(entries.some((entry) => entry.kind === 'ask' && entry.ask?.id === 'hidden-ask'), false);
  assert.equal(entries.some((entry) => entry.text === '公共引用' && entry.refs?.blockId === 'public'), true);
  for (const secret of Object.values(hiddenSecrets)) {
    assert.equal(entries.some((entry) => entry.text === secret), false);
  }
  assert.equal(entries.some((entry) => entry.text === unknownSecret), false);
  assert.doesNotMatch(JSON.stringify(entries), /UNIQUE-(?:HIDDEN|UNKNOWN)-STREAM-(?:MESSAGE|PROGRESS|RECEIPT)-SECRET/);

  const answer = await fetch(`${baseUrl}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-workbench-token': 'alice-visibility-token' },
    body: JSON.stringify({ session, answerTo: 'hidden-ask', answerValue: 'a' }),
  });
  assert.equal(answer.status, 403);
});

test('参与者 feedback 只返回当前可见且已知 ID，unanswered/未知 ID 和不可验证内容默认拒绝', async () => {
  const session = 'feedback-default-deny';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共块' },
    { id: 'bob-only', type: 'markdown', body: '小波反馈秘密', assignee: 'bob' },
  ]);
  writeJSON(paths.feedback(session, 1, { exactSession: true }), {
    session,
    round: 1,
    items: [
      { blockId: 'public', type: 'text', value: '公共反馈' },
      { blockId: 'bob-only', type: 'text', value: '隐藏反馈秘密' },
      { blockId: 'old-block', type: 'text', value: '未知旧反馈' },
    ],
    unanswered: ['public', 'bob-only', 'old-block'],
    submittedBy: { id: 'owner', name: '管理员' },
  });
  const visible = await fetch(`${baseUrl}/api/feedback?session=${session}&round=1`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(visible.status, 200);
  const visibleBody = await visible.json();
  assert.deepEqual(visibleBody.feedback.items.map((item) => item.blockId), ['public']);
  assert.deepEqual(visibleBody.feedback.unanswered, ['public']);
  assert.doesNotMatch(JSON.stringify(visibleBody), /bob-only|old-block|隐藏反馈秘密|未知旧反馈/);

  const ownerVisible = await fetch(`${baseUrl}/api/feedback?session=${session}&round=1`, {
    headers: { 'x-workbench-token': OWNER_TOKEN },
  });
  assert.equal(ownerVisible.status, 200);
  const ownerBody = await ownerVisible.json();
  assert.deepEqual(ownerBody.feedback.items.map((item) => item.blockId), ['public', 'bob-only', 'old-block']);
  assert.deepEqual(ownerBody.feedback.unanswered, ['public', 'bob-only', 'old-block']);

  const unknownWrite = await postFeedback(session, 'alice-visibility-token', [
    { blockId: 'not-a-block', type: 'select', value: 'forged' },
  ]);
  assert.equal(unknownWrite.response.status, 403);

  for (const name of ['missing', 'invalid']) {
    const edgeSession = `${session}-${name}`;
    contentFor(edgeSession, [{ id: 'hidden', type: 'markdown', body: '不可返回的反馈内容', assignee: 'bob' }]);
    writeJSON(paths.feedback(edgeSession, 1, { exactSession: true }), {
      session: edgeSession,
      round: 1,
      items: [{ blockId: 'hidden', type: 'text', value: '不可返回的反馈内容' }],
      submittedBy: { id: 'owner', name: '管理员' },
    });
    if (name === 'missing') fs.rmSync(paths.content(edgeSession, 1, { exactSession: true }));
    else fs.writeFileSync(paths.content(edgeSession, 1, { exactSession: true }), '{invalid json');
    const response = await fetch(`${baseUrl}/api/feedback?session=${edgeSession}&round=1`, {
      headers: { 'x-workbench-token': 'alice-visibility-token' },
    });
    assert.equal(response.status, 200, name);
    const body = await response.json();
    assert.equal(body.ok, false, name);
    assert.equal(Object.hasOwn(body, 'feedback'), false, name);
  }
});

test('participant 调用 /api/retry 被拒且不能改变整轮文件', async () => {
  const session = 'retry-owner-only';
  contentFor(session, [{ id: 'public', type: 'markdown', body: '内容' }]);
  writeJSON(paths.ack(session, 1, { exactSession: true }), { ok: true });
  writeJSON(paths.error(session, 1, { exactSession: true }), { message: '错误' });
  const response = await fetch(`${baseUrl}/api/retry?session=${session}&round=1`, {
    method: 'POST',
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(response.status, 403);
  assert.equal(fs.existsSync(paths.ack(session, 1, { exactSession: true })), true);
  assert.equal(fs.existsSync(paths.error(session, 1, { exactSession: true })), true);
  assert.equal(readJSON(paths.status(session, { exactSession: true })).state, 'rendered');
});

test('participant token 吊销后 /api/content 与 /api/feedback 立即失效', async () => {
  const session = 'revoked-visibility-token';
  contentFor(session, [{ id: 'public', type: 'markdown', body: '公共内容' }]);
  writeJSON(paths.feedback(session, 1, { exactSession: true }), {
    session,
    round: 1,
    items: [],
    submittedBy: { id: 'owner', name: '管理员' },
  });
  assert.equal(revokeParticipant('alice', { filePath: participantsFile }), true);
  try {
    const content = await fetch(`${baseUrl}/api/content?session=${session}&round=1`, {
      headers: { 'x-workbench-token': 'alice-visibility-token' },
    });
    assert.equal(content.status, 403);
    const feedback = await fetch(`${baseUrl}/api/feedback?session=${session}&round=1`, {
      headers: { 'x-workbench-token': 'alice-visibility-token' },
    });
    assert.equal(feedback.status, 403);
  } finally {
    fs.writeFileSync(participantsFile, JSON.stringify(PARTICIPANTS, null, 2));
  }
});
