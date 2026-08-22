// 守卫：app.css 必须统一用 --color-* 变量。
// 历史 bug：误用 var(--bg)/var(--text)/var(--accent)/var(--border)（未定义）→ 回退硬编码浅色 → 暗色模式浅字白底、对比度失效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(path.resolve(__dirname, '../../src/render/app.css'), 'utf8');
const themeCss = readFileSync(path.resolve(__dirname, '../../src/render/theme.css'), 'utf8');
const css = themeCss + '\n' + appCss;

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


// 2026-08-22 视觉与结构解耦：创始人问「视觉相关的是不是都和代码解耦」——
// 当时答案是"没有，143 处字号硬编码在 app.css"。抽进 theme.css 后加这条守卫，
// 免得以后又一点点漏回去。
test('app.css 不得硬编码字号：视觉数值必须住在 theme.css', () => {
  const hard = appCss.match(/font-size:\s*[0-9.]+px/g) || [];
  assert.deepEqual(hard, [], `app.css 出现硬编码字号，应改用 theme.css 的 --fs-* 令牌：${hard.join(', ')}`);
});

test('theme.css 提供整体缩放与版心两个常用旋钮', () => {
  assert.match(themeCss, /--ui-scale:\s*[\d.]+/, '应有 --ui-scale 整体字号缩放');
  assert.match(themeCss, /--content-max:/, '应有 --content-max 版心宽度');
  assert.match(themeCss, /--fs-tab:/, '应有 --fs-tab 分面导航条字号');
});

test('抗锯齿按屏幕密度分开：1 倍屏不强制灰度抗锯齿', () => {
  // 灰度抗锯齿在 1 倍屏上会削细中文笔画，观感发"扁"（创始人 2026-08-22 反馈）
  assert.match(themeCss, /@media \(min-resolution: 2dppx\)/, '应有高密度屏媒体查询');
  assert.ok(
    !/^\s*-webkit-font-smoothing/m.test(appCss),
    'app.css 不应无条件写死 -webkit-font-smoothing',
  );
});

// 2026-08-22 回归：把令牌从 app.css 挪进 theme.css 时漏了控制塔页面 ——
// 它只引了 app.css，于是 control.css 里 38 处 var(--color-*) 全部落空、配色崩掉。
// 凡是引 app.css 的页面都必须先引 theme.css。
test('所有引用 app.css 的页面都必须先引 theme.css', () => {
  const pages = ['../../src/render/index.html', '../../src/control/index.html'];
  for (const rel of pages) {
    const html = readFileSync(path.resolve(__dirname, rel), 'utf8');
    if (!html.includes('app.css')) continue;
    assert.ok(html.includes('theme.css'), `${rel} 引了 app.css 却没引 theme.css，令牌会全部落空`);
    assert.ok(
      html.indexOf('theme.css') < html.indexOf('app.css'),
      `${rel} 的 theme.css 必须排在 app.css 之前`,
    );
  }
});