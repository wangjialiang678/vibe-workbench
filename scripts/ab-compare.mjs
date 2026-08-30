#!/usr/bin/env node
// 重构对拍安全网：冻结基线与当前树各起一个 HTTP server，逐请求严格比较。
// 仅允许归一化协议明确列出的 ts / assetsVersion；其余响应和夹具写盘变化必须相同。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'refactor-baseline-2026-08-30';
const OWNER_TOKEN = 'ab-owner-token';
const PARTICIPANT_TOKEN = 'ab-participant-token';
const TIMEOUT_MS = 2_000;
const FROZEN_NOW = '2026-08-30T12:00:00.000Z';

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') {
      args.base = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--self-test') args.selfTest = true;
    else if (argv[index] === '--help') {
      console.log('Usage: node scripts/ab-compare.mjs [--base <tag-or-sha>] [--self-test]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

function command(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function copyDirectory(source, target) {
  await fs.cp(source, target, { recursive: true });
}

async function treeSnapshot(root) {
  const entries = {};
  async function visit(directory) {
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute);
      if (child.isDirectory()) await visit(absolute);
      else if (child.isFile()) {
        const data = await fs.readFile(absolute);
        entries[relative] = createHash('sha256').update(data).digest('hex');
      } else entries[relative] = `<${child.isSymbolicLink() ? 'symlink' : 'other'}>`;
    }
  }
  await visit(root);
  return entries;
}

function treeDelta(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].sort().flatMap((file) => (
    before[file] === after[file] ? [] : [{ file, before: before[file] ?? null, after: after[file] ?? null }]
  ));
}

// 只根据对拍契约规范化 body 的两个字段；不要把真实行为差异“清洗”掉。
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === 'ts' || key === 'assetsVersion' ? '<normalized>' : normalize(item),
  ]));
}

// rawHeaders 是 [name, value, name, value...]；HTTP Date 是传输时间，不是行为结果。
// 转为大小写无关的对象后只归一化 Date，重复头仍保留为数组以避免吞掉其他头差异。
function normalizeHeaders(rawHeaders = []) {
  const normalized = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = String(rawHeaders[index] ?? '').toLowerCase();
    const value = name === 'date' ? '<normalized>' : String(rawHeaders[index + 1] ?? '');
    if (Object.hasOwn(normalized, name)) {
      normalized[name] = Array.isArray(normalized[name])
        ? [...normalized[name], value]
        : [normalized[name], value];
    } else normalized[name] = value;
  }
  return normalized;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutExpectedChanges(response, expectedChange) {
  if (expectedChange !== 'health-version-fields' || !response.body || typeof response.body !== 'object' || Array.isArray(response.body)) return response;
  const { version, commit, ...body } = response.body;
  return { ...response, body };
}

function request(baseUrl, spec) {
  return new Promise((resolve) => {
    const requestUrl = new URL(spec.path, baseUrl);
    const body = spec.body == null ? null : (Buffer.isBuffer(spec.body) ? spec.body : Buffer.from(JSON.stringify(spec.body)));
    // 两台 server 必然监听不同端口；固定 Host，避免端口本身污染 render/invite URL 对拍。
    const headers = { host: 'ab.fixture.test', ...(spec.headers || {}) };
    if (spec.identity === 'owner') headers['x-workbench-token'] = OWNER_TOKEN;
    if (spec.identity === 'participant') headers['x-workbench-token'] = PARTICIPANT_TOKEN;
    if (body && !headers['content-type']) headers['content-type'] = 'application/json';
    if (body) headers['content-length'] = String(body.length);
    const started = Date.now();
    let settled = false;
    const finish = (outcome) => {
      if (!settled) { settled = true; resolve({ ...outcome, elapsedMs: Date.now() - started }); }
    };
    const req = http.request(requestUrl, { method: spec.method, headers }, (res) => {
      const chunks = [];
      let ended = false;
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('aborted', () => finish({ termination: 'aborted', status: res.statusCode, headers: res.rawHeaders, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('end', () => { ended = true; finish({ termination: 'ended', status: res.statusCode, headers: res.rawHeaders, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('close', () => { if (!ended) finish({ termination: 'closed', status: res.statusCode, headers: res.rawHeaders, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(new Error('hard timeout')); });
    req.on('error', (error) => finish({ termination: error.message === 'hard timeout' ? 'timeout' : 'request-error', error: error.message }));
    if (body) req.write(body);
    req.end();
  });
}

function normalResponse(result) {
  let parsed = result.body;
  try { parsed = JSON.parse(result.body); } catch { /* HTML/static files remain strings */ }
  return {
    termination: result.termination,
    status: result.status,
    headers: normalizeHeaders(result.headers),
    body: normalize(parsed),
  };
}

function assertHeaderNormalization() {
  const baseline = normalResponse({
    termination: 'ended', status: 200,
    headers: ['Date', 'Sun, 30 Aug 2026 12:00:00 GMT', 'X-Probe', 'same'],
    body: '{"ok":true,"ts":1}',
  });
  const dateOnlyChanged = normalResponse({
    termination: 'ended', status: 200,
    headers: ['date', 'Sun, 30 Aug 2026 12:00:01 GMT', 'x-probe', 'same'],
    body: '{"ok":true,"ts":2}',
  });
  const realHeaderChanged = normalResponse({
    termination: 'ended', status: 200,
    headers: ['DATE', 'Sun, 30 Aug 2026 12:00:01 GMT', 'X-Probe', 'different'],
    body: '{"ok":true,"ts":2}',
  });
  assert.ok(equal(baseline, dateOnlyChanged), 'Date-only response differences must be ignored');
  assert.ok(!equal(baseline, realHeaderChanged), 'a non-Date response header difference must remain visible');
}

function endpointCases() {
  const identities = ['owner', 'participant', 'none'];
  const cases = [
    ['GET', '/api/health'], ['GET', '/api/control-tower'],
    ['POST', '/api/worker-heartbeat', { at: FROZEN_NOW, label: 'ab-fixture' }],
    ['GET', '/api/documents?session=alpha'], ['POST', '/api/documents', { session: 'alpha', category: 'AB', slug: 'safety-net', title: 'AB document', body: 'Deterministic fixture document.' }],
    ['GET', '/api/messages?session=alpha'], ['POST', '/api/messages', { session: 'alpha', text: 'Deterministic fixture message.' }],
    ['GET', '/api/participants-public?session=alpha'], ['GET', '/api/participants'], ['POST', '/api/participants', { id: 'ab-temp', name: 'AB Temporary' }],
    ['POST', '/api/stream-events', { session: 'alpha', kind: 'progress', text: 'Deterministic fixture event.' }],
    ['POST', '/api/attachments?session=alpha', Buffer.from([137, 80, 78, 71]), { 'content-type': 'image/png', 'x-file-name': 'fixture.png' }],
    ['GET', '/api/assets?session=alpha'], ['GET', '/api/sessions'], ['GET', '/api/projects'], ['GET', '/api/session-context?session=alpha'],
    ['POST', '/api/rounds', { session: 'delta', title: 'AB generated round', blocks: [{ id: 'note', type: 'markdown', body: 'Deterministic fixture round.' }] }], ['GET', '/api/feedback?session=alpha&round=1'], ['GET', '/api/status?session=alpha'],
    ['GET', '/api/content?session=alpha&round=2'], ['POST', '/api/feedback', { session: 'alpha', round: 2, items: [{ blockId: 'plan', type: 'choice', select: 'safe' }] }], ['GET', '/api/proxy'],
    ['GET', '/api/inbox/tasks'], ['POST', '/api/inbox/tasks', { executor: 'local-mac', session: 'alpha', type: 'manual', title: 'AB task', payload: {} }], ['GET', '/assets/alpha/missing.txt'], ['GET', '/render/index.html'],
    // 近似路径保护：必须覆盖每一个相邻路由，避免错误的 startsWith 吞掉请求或挂起。
    ['GET', '/api/participants-public/foo'], ['GET', '/api/participantsXYZ'], ['GET', '/api/participant'], ['GET', '/api/inbox'],
    ['GET', '/api/inboxx'], ['GET', '/api/sessionx'], ['GET', '/api/sessionsx'], ['GET', '/assets'], ['GET', '/assetsx'],
    ['GET', '/render/x'], ['GET', '/renderx'],
  ];
  return identities.flatMap((identity) => cases.map(([method, requestPath, body, headers]) => ({
    identity, method, path: requestPath, body, headers, write: method !== 'GET',
    // 第 5 期唯一允许的协议变化：health 新增部署可调试字段。
    expectedChange: method === 'GET' && requestPath === '/api/health' ? 'health-version-fields' : null,
  })));
}

async function startServer(sourceRoot, workspace, port, clockFile) {
  const bootstrap = [
    "import { pathToFileURL } from 'node:url';",
    "const source = process.env.AB_SOURCE;",
    "const participantsFile = process.env.WB_PARTICIPANTS_FILE;",
    "const { startServer } = await import(pathToFileURL(source + '/src/server/server.mjs').href);",
    "const server = startServer(Number(process.env.AB_PORT), '127.0.0.1', { participantsFile });",
    "server.once('listening', () => console.log('AB_READY'));",
  ].join('\n');
  const child = spawn(process.execPath, ['--require', clockFile, '--input-type=module', '--eval', bootstrap], {
    cwd: sourceRoot,
    env: {
      ...process.env,
      AB_SOURCE: sourceRoot,
      AB_PORT: String(port),
      WB_WORKSPACE: workspace,
      WB_PARTICIPANTS_FILE: path.join(workspace, 'config', 'participants.json'),
      WORKBENCH_TOKEN: OWNER_TOKEN,
      WORKBENCH_EVENT_WEBHOOK: '',
      // 对拍的是冻结版已公开的 HTTP 协议；执行面默认关态另由 cloud-ai-loop
      // 覆盖。两侧显式 on 才能逐字节比较历史 inbox/dispatch 行为。
      WB_CLOUD_AI: 'on',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server failed to start: ${stderr}`)), TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('AB_READY')) { clearTimeout(timeout); resolve(); }
    });
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited during startup (${code}): ${stderr}`)); });
  });
  return child;
}

async function stop(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function compareRequest(pair, baseUrl, workUrl, baseFixture, workFixture, { injectDifference = false } = {}) {
  const before = pair.write ? await Promise.all([treeSnapshot(baseFixture), treeSnapshot(workFixture)]) : null;
  const [baseResult, workResult] = await Promise.all([request(baseUrl, pair), request(workUrl, pair)]);
  const after = pair.write ? await Promise.all([treeSnapshot(baseFixture), treeSnapshot(workFixture)]) : null;
  const baseline = withoutExpectedChanges(normalResponse(baseResult), pair.expectedChange);
  const working = withoutExpectedChanges(normalResponse(workResult), pair.expectedChange);
  if (injectDifference) working.body = { injected: 'known self-test difference' };
  const differences = [];
  if (baseline.termination === 'timeout' || working.termination === 'timeout') differences.push('hard timeout');
  if (!equal(baseline, working)) differences.push({ response: { baseline, working } });
  if (pair.write) {
    const baseDelta = treeDelta(before[0], after[0]);
    const workDelta = treeDelta(before[1], after[1]);
    if (!equal(baseDelta, workDelta)) differences.push({ fileTree: { baseline: baseDelta, working: workDelta } });
  }
  return differences;
}

async function run({ base, selfTest }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-ab-'));
  const baselineRoot = path.join(tempRoot, 'baseline');
  const baseFixture = path.join(tempRoot, 'fixture-baseline');
  const workFixture = path.join(tempRoot, 'fixture-working');
  const seed = path.join(ROOT, 'tests', 'fixtures', 'ab-seed');
  const clockFile = path.join(tempRoot, 'frozen-clock.cjs');
  // 写路由本来会生成 UUID / 随机文件名。对拍子进程专用 preload 固定它们，
  // 这样文件树的差异才反映行为，而不是两次运行的随机噪声。
  const clockSource = `const RealDate = Date; const frozen = RealDate.parse(${JSON.stringify(FROZEN_NOW)}); global.Date = class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [frozen])); } static now() { return frozen; } }; const crypto = require('node:crypto'); let sequence = 0; crypto.randomUUID = () => { sequence += 1; return \`00000000-0000-4000-8000-\${sequence.toString(16).padStart(12, '0')}\`; }; crypto.randomBytes = (size) => { sequence += 1; return Buffer.from(Array.from({ length: size }, (_, i) => (sequence + i) & 255)); };`;
  let baseServer; let workServer; let worktreeAdded = false;
  try {
    if (selfTest) assertHeaderNormalization();
    await fs.writeFile(clockFile, clockSource);
    await command('git', ['worktree', 'add', '--detach', baselineRoot, base]);
    worktreeAdded = true;
    await Promise.all([copyDirectory(seed, baseFixture), copyDirectory(seed, workFixture)]);
    const [basePort, workPort] = await Promise.all([freePort(), freePort()]);
    [baseServer, workServer] = await Promise.all([
      startServer(baselineRoot, baseFixture, basePort, clockFile),
      startServer(ROOT, workFixture, workPort, clockFile),
    ]);
    const baseUrl = `http://127.0.0.1:${basePort}`;
    const workUrl = `http://127.0.0.1:${workPort}`;
    const cases = selfTest
      ? [{ identity: 'owner', method: 'GET', path: '/api/health', write: false }]
      : [...endpointCases(), { identity: 'owner', method: 'POST', path: '/api/retry?session=gamma&round=1', body: {}, write: true }];
    assert.ok(cases.length >= 60 || selfTest, `request list must contain >=60 cases, got ${cases.length}`);
    const failures = [];
    for (const item of cases) {
      const differences = await compareRequest(item, baseUrl, workUrl, baseFixture, workFixture, { injectDifference: selfTest });
      if (differences.length) failures.push({ item: `${item.identity} ${item.method} ${item.path}`, differences });
    }
    if (selfTest) {
      assert.ok(failures.length > 0, 'self-test must detect the injected response difference');
      console.error(`SELF-TEST detected ${failures.length} intentional difference(s).`);
      for (const failure of failures) console.error(JSON.stringify(failure, null, 2));
      return 1;
    }
    if (failures.length) {
      console.error(`AB comparison found ${failures.length}/${cases.length} difference(s).`);
      for (const failure of failures) console.error(JSON.stringify(failure, null, 2));
      return 1;
    }
    console.log(`AB comparison passed: ${cases.length} requests, 0 differences (base ${base}).`);
    return 0;
  } finally {
    await Promise.allSettled([stop(baseServer), stop(workServer)]);
    if (worktreeAdded) await command('git', ['worktree', 'remove', '--force', baselineRoot]).catch(() => {});
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
run(args).then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`AB comparison failed to run: ${error.stack || error.message}`);
  process.exitCode = 2;
});
