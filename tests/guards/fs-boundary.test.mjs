import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allowed = new Set([
  'src/storage/index.mjs',
  'src/server/version.mjs', // 仅在启动时读取 package/version 部署元数据
  'src/server/routes/pages.mjs', // 静态托管（04 §1 例外）
  'src/loop/agent-exec.mjs', // 可执行文件探测（04 §1 例外）
  'bin/workbench.mjs',
  'scripts/import-prd-project.mjs',
  'scripts/local-listener.mjs',
  'scripts/resident-worker.mjs',
  'scripts/ab-compare.mjs', // 重构验收 harness 的隔离夹具 I/O
  'scripts/write-version.mjs', // 部署前生成 commit 元数据，服务端不调用 git
]);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : (entry.name.endsWith('.mjs') ? [full] : []);
  });
}

test('fs 边界：node:fs 及 fs.<call> 只出现在 storage 或明确例外', () => {
  const candidates = ['src', 'scripts', 'bin'].flatMap((dir) => files(path.join(root, dir)));
  const offenders = candidates.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const usesFs = /from\s+['\"](?:node:)?fs(?:\/promises)?['\"]|\bfs\s*\./.test(source);
    const relative = path.relative(root, file);
    return usesFs && !allowed.has(relative) ? [relative] : [];
  });
  assert.deepEqual(offenders, []);
});
