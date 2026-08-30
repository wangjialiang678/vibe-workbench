import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcRoot = path.join(root, 'src');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : entry.isFile() && entry.name.endsWith('.mjs') ? [target] : [];
  });
}

function importsFor(file) {
  const source = readFileSync(file, 'utf8');
  const pattern = /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const imports = [];
  for (const match of source.matchAll(pattern)) {
    if (!match[1].startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), match[1]);
    imports.push(path.extname(target) ? target : `${target}.mjs`);
  }
  return imports;
}

const files = sourceFiles(srcRoot);
const graph = new Map(files.map((file) => [file, importsFor(file).filter((target) => files.includes(target))]));
const relative = (file) => path.relative(root, file).split(path.sep).join('/');

test('分层：render 只依赖 render/protocol，routes 不反向依赖 server 主模块', () => {
  for (const [file, imports] of graph) {
    const from = relative(file);
    if (from.startsWith('src/render/')) {
      for (const target of imports) assert.match(relative(target), /^src\/(?:render|protocol)\//, `${from} 不得向上依赖 ${relative(target)}`);
    }
    if (from.startsWith('src/server/routes/')) {
      assert.ok(!imports.some((target) => relative(target) === 'src/server/server.mjs'), `${from} 不得反向依赖 server 主模块`);
    }
  }
});

test('分层：src import 图无环', () => {
  const active = new Set(); const visited = new Set();
  function visit(file, chain) {
    if (active.has(file)) assert.fail(`检测到 import 环：${[...chain, file].map(relative).join(' -> ')}`);
    if (visited.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) || []) visit(target, [...chain, file]);
    active.delete(file); visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
});
