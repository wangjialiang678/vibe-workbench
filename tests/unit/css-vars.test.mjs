// 守卫：app.css 必须统一用 --color-* 变量。
// 历史 bug：误用 var(--bg)/var(--text)/var(--accent)/var(--border)（未定义）→ 回退硬编码浅色 → 暗色模式浅字白底、对比度失效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(__dirname, '../../src/render/app.css'), 'utf8');

test('app.css 不得使用未定义的颜色变量（必须用 --color-*）', () => {
  const bad = css.match(/var\(--(bg|text|accent|border|accent-weak|surface|focus)[,)]/g) || [];
  assert.deepEqual(bad, [], `发现未定义变量（应为 --color-*）：${bad.join(', ')}`);
});

test('app.css 定义了亮/暗两套 --color-* 且暗色覆盖关键色', () => {
  assert.ok(css.includes('prefers-color-scheme: dark'), '应有暗色媒体查询');
  for (const v of ['--color-bg', '--color-surface', '--color-text', '--color-border', '--color-focus']) {
    assert.ok(css.includes(v), `应定义 ${v}`);
  }
});

test('云端 worker 在线状态使用既有绿色状态变量', () => {
  assert.match(
    css,
    /\.status-worker-online\s*\{[^}]*--color-status-ok[^}]*\}/s,
  );
});
