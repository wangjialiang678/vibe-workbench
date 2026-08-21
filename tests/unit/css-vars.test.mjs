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

// 2026-08-21 视觉重做：暗色模式整套删除，固定亮色。
// 创始人明示「不要设置跟随系统的颜色，黑底看起来很不舒服，都默认是白底」。
// 这条测试从「必须有暗色媒体查询」反转为「不许有」，避免以后无意中把跟随系统加回来。
test('app.css 固定亮色：不得跟随系统暗色', () => {
  assert.ok(
    !css.includes('prefers-color-scheme'),
    '不应出现 prefers-color-scheme —— 页面固定白底，不跟随系统配色',
  );
  assert.match(css, /color-scheme:\s*light only/, '应在 :root 声明 color-scheme: light only');
});

test('app.css 定义了完整的 --color-* 令牌', () => {
  for (const v of ['--color-bg', '--color-bg-subtle', '--color-surface', '--color-text',
    '--color-border', '--color-border-strong', '--color-focus']) {
    assert.ok(css.includes(v), `应定义 ${v}`);
  }
});

test('app.css 中文字体栈显式点名中文字体', () => {
  // 只写 -apple-system/system-ui 会让中文兜底到 Heiti SC 一类又宽又扁的字体
  assert.match(css, /--font-sans:[^;]*PingFang SC/s, '--font-sans 应显式包含 PingFang SC');
  assert.match(css, /-webkit-font-smoothing:\s*antialiased/, '应开启灰度抗锯齿');
});

test('云端 worker 在线状态使用既有绿色状态变量', () => {
  assert.match(
    css,
    /\.status-worker-online\s*\{[^}]*--color-status-ok[^}]*\}/s,
  );
});
