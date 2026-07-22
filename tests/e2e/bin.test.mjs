// tests/e2e/bin.test.mjs — TDD for bin/workbench.mjs (DESIGN §7)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/workbench.mjs');
const ROOT = path.resolve(__dirname, '../..');

let tmpDir;
let cmdRender;
let paths;
let readStatus;

before(async () => {
  // 创建临时 workspace
  tmpDir = await mkdtemp(path.join(tmpdir(), 'wb-e2e-'));
  process.env.WB_WORKSPACE = tmpDir;

  // 动态 import bin（运行时需用 WB_WORKSPACE）
  // 注意：ESM 模块缓存 — 先设好环境变量再 import
  const bin = await import(BIN);
  cmdRender = bin.cmdRender;

  // 同时 import workspace 工具用于断言
  const ws = await import(`${ROOT}/src/workspace.mjs`);
  paths = ws.paths;
  readStatus = ws.readStatus;
});

after(async () => {
  delete process.env.WB_WORKSPACE;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe('cmdRender', () => {
  it('写入 content.json 且 status.state === rendered', async () => {
    const content = {
      session: 's1',
      round: 1,
      blocks: [{ id: 'a', type: 'markdown', body: 'x' }],
    };

    const result = await cmdRender('s1', content);

    assert.equal(result.session, 's1');
    assert.equal(result.round, 1);

    // content.json 存在
    const { readJSON } = await import(`${ROOT}/src/workspace.mjs`);
    const stored = readJSON(paths.content('s1', 1));
    assert.ok(stored, 'content.json should exist');
    assert.equal(stored.session, 's1');
    assert.equal(stored.round, 1);

    // status.state === 'rendered'
    const status = readStatus('s1');
    assert.ok(status, 'status.json should exist');
    assert.equal(status.state, 'rendered');
  });

  it('content.md 存在且含 block body 文本', async () => {
    const content = {
      session: 's2',
      round: 1,
      blocks: [
        { id: 'b1', type: 'markdown', title: '标题', body: '内容文本' },
      ],
    };

    await cmdRender('s2', content);

    const { readText } = await import(`${ROOT}/src/workspace.mjs`);
    const md = readText(paths.contentMd('s2', 1));
    assert.ok(md, 'content.md should exist');
    assert.ok(md.includes('内容文本'), 'content.md should contain block body');
  });

  it('validateContent 失败时抛出含 errors 的错误', async () => {
    const badContent = { session: 's3', round: 0, blocks: [] }; // round < 1 无效

    await assert.rejects(
      () => cmdRender('s3', badContent),
      (err) => {
        assert.ok(err.errors, 'error should have .errors');
        assert.ok(Array.isArray(err.errors), '.errors should be array');
        return true;
      },
    );
  });

  it('未传 round 时自动取 latestRound+1', async () => {
    // 先写 round 3，再 render 无 round 的 content → 应产出 round 4
    const first = {
      session: 's4',
      round: 3,
      blocks: [{ id: 'c', type: 'markdown', body: 'seed' }],
    };
    await cmdRender('s4', first);

    const second = {
      session: 's4',
      // 不传 round
      blocks: [{ id: 'd', type: 'markdown', body: 'next' }],
    };
    const result = await cmdRender('s4', second);
    assert.equal(result.round, 4);
  });
});

describe('CLI --help', () => {
  it('输出含 render serve watch up', async () => {
    const { stdout } = await execFileAsync('node', [BIN, '--help']);
    const out = stdout.toLowerCase();
    assert.ok(out.includes('render'), '--help should mention render');
    assert.ok(out.includes('serve'), '--help should mention serve');
    assert.ok(out.includes('watch'), '--help should mention watch');
    assert.ok(out.includes('up'), '--help should mention up');
  });

  it('serve/up 帮助展示 --host 与默认监听地址', async () => {
    const { stdout } = await execFileAsync('node', [BIN, '--help']);
    assert.match(stdout, /--host/);
    assert.match(stdout, /127\.0\.0\.1/);
  });
});

describe('CLI render subcommand', () => {
  it('render <session> - 从 stdin 读取 JSON 并写入文件', async () => {
    const content = JSON.stringify({
      session: 'cli1',
      round: 1,
      blocks: [{ id: 'e', type: 'markdown', body: 'cli test' }],
    });

    // 写临时文件（避免 execFile 不支持 input 选项的问题）
    const tmpJson = path.join(tmpDir, 'cli-render-tmp.json');
    await writeFile(tmpJson, content, 'utf8');

    const { stdout } = await execFileAsync(
      'node',
      [BIN, 'render', 'cli1', tmpJson],
      { env: { ...process.env, WB_WORKSPACE: tmpDir } },
    );

    // 输出应含 round 信息
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.session, 'cli1');
    assert.equal(parsed.round, 1);
  });

  it('render <session> - 从 - (stdin) 读取 JSON', async () => {
    const content = JSON.stringify({
      session: 'cli2',
      round: 1,
      blocks: [{ id: 'f', type: 'markdown', body: 'stdin test' }],
    });

    // 用 spawn 手动写 stdin
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn('node', [BIN, 'render', 'cli2', '-'], {
        env: { ...process.env, WB_WORKSPACE: tmpDir },
      });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`exit code ${code}`));
      });
      child.on('error', reject);
      child.stdin.write(content);
      child.stdin.end();
    });

    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.session, 'cli2');
    assert.equal(parsed.round, 1);
  });
});
