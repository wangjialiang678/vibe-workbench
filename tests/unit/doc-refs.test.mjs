import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });

test('文档引用完整性检查通过', { skip: python.error?.code === 'ENOENT' }, () => {
  const result = spawnSync('python3', ['tools/check_doc_refs.py', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
