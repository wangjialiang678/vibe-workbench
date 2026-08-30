// 协议契约快照：首次以 UPDATE_GOLDEN=1 生成，常规测试只做严格比对。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDiff } from '../../src/protocol/diff.mjs';
import { routeBlocks } from '../../src/protocol/attention.mjs';
import { validateContent } from '../../src/protocol/schema.mjs';
import { blockHtml } from '../../src/render/blocks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, '../fixtures/golden');
const fixtureNames = fs.readdirSync(fixtureDir)
  .filter((name) => /^\d\d-.*\.json$/.test(name) && !name.endsWith('.golden.json'))
  .sort();
const byName = new Map(fixtureNames.map((name) => [name, JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'))]));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function snapshotFor(name, content) {
  const previous = name === '09-diff-current.json'
    ? byName.get('08-diff-previous.json').blocks
    : [];
  const diff = computeDiff(content.blocks, previous);
  return stable({
    computeDiff: diff,
    routeBlocks: routeBlocks(diff),
    validateContent: validateContent(content),
    blockHtml: content.blocks.map((block) => blockHtml({ ...block, _change: 'new' })),
  });
}

test('golden fixtures: exactly ten representative content documents', () => {
  assert.equal(fixtureNames.length, 10);
  for (const type of ['choice', 'verdict', 'markdown', 'prototype', 'diagram']) {
    assert.ok([...byName.values()].some((content) => content.blocks.some((block) => block.type === type)), type);
  }
  assert.equal(byName.get('09-diff-current.json').prevRound, 1);
});

for (const name of fixtureNames) {
  function readGolden() {
    const content = byName.get(name);
    const actual = snapshotFor(name, content);
    const goldenPath = path.join(fixtureDir, name.replace(/\.json$/, '.golden.json'));
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    assert.ok(fs.existsSync(goldenPath), `missing golden: run UPDATE_GOLDEN=1 node --test ${here}`);
    return { actual, expected: JSON.parse(fs.readFileSync(goldenPath, 'utf8')) };
  }

  test(`protocol golden computeDiff: ${name}`, () => {
    const { actual, expected } = readGolden();
    assert.deepEqual(actual.computeDiff, expected.computeDiff);
    assert.ok(Array.isArray(actual.computeDiff));
  });
  test(`protocol golden routeBlocks: ${name}`, () => {
    const { actual, expected } = readGolden();
    assert.deepEqual(actual.routeBlocks, expected.routeBlocks);
    assert.equal(typeof actual.routeBlocks, 'object');
  });
  test(`protocol golden validateContent: ${name}`, () => {
    const { actual, expected } = readGolden();
    assert.deepEqual(actual.validateContent, expected.validateContent);
    assert.equal(actual.validateContent.ok, true);
  });
  test(`protocol golden blockHtml: ${name}`, () => {
    const { actual, expected } = readGolden();
    assert.deepEqual(actual.blockHtml, expected.blockHtml);
    assert.equal(actual.blockHtml.length, byName.get(name).blocks.length);
  });
}
