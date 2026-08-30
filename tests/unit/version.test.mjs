import test from 'node:test';
import assert from 'node:assert/strict';
import { readHealthVersion } from '../../src/server/version.mjs';

test('readHealthVersion reads package version and deployment commit without git', () => {
  const reads = new Map([
    ['/fixture/package.json', '{"version":"2.4.6"}'],
    ['/fixture/version.json', '{"commit":"abc123"}'],
  ]);
  const value = readHealthVersion({
    root: '/fixture',
    readFile(file) { return reads.get(file); },
  });
  assert.deepEqual(value, { version: '2.4.6', commit: 'abc123' });
});

test('readHealthVersion uses unknown when deployment metadata is absent or invalid', () => {
  const value = readHealthVersion({
    root: '/fixture',
    readFile(file) {
      if (file.endsWith('package.json')) return '{"version":"2.4.6"}';
      throw new Error('ENOENT');
    },
  });
  assert.deepEqual(value, { version: '2.4.6', commit: 'unknown' });
});
