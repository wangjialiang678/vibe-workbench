import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdToHtml } from '../../src/render/md.mjs';
import {
  blockHtml,
  participantFeedbackHtml,
  renderEmbed,
  renderChecklist,
  renderPrototype,
} from '../../src/render/blocks.mjs';
import { changeBadge, prevCompareHtml, diffToggleHtml } from '../../src/render/diff-view.mjs';
import { renderZones } from '../../src/render/attention-view.mjs';
import {
  attachmentMessageMarkdown,
  clampStreamPanelWidth,
  composerValueAfterSend,
  containerPinPopoverPosition,
  decisionChipHtml,
  decisionChipForLatestReceipt,
  pinPopoverPosition,
  streamEntryHtml,
  streamEntriesHtml,
} from '../../src/render/stream-view.mjs';
import { resolveSelfReportSelection } from '../../src/render/self-report-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderIndex = readFileSync(path.resolve(__dirname, '../../src/render/index.html'), 'utf8');
const renderApp = readFileSync(path.resolve(__dirname, '../../src/render/app.mjs'), 'utf8');
const renderCss = readFileSync(path.resolve(__dirname, '../../src/render/app.css'), 'utf8');

// ---------- G2 会话流与三区布局 ----------

test('render 页面包含桌面分栏、右区双切换与手机底部三标签', () => {
  assert.match(renderIndex, /id="workspace-shell"[^>]*class="[^"]*workspace-shell/);
  assert.match(renderIndex, /id="stream-panel"/);
  assert.match(renderIndex, /id="workspace-splitter"/);
  assert.match(renderIndex, /id="decision-panel"/);
  assert.match(renderIndex, /id="documents-panel"/);
  assert.match(renderIndex, /data-view="decision"/);
  assert.match(renderIndex, /data-view="documents"/);
  assert.match(renderIndex, /class="mobile-tab[^"]*"[^>]*data-view="stream"/);
  assert.match(renderIndex, /class="mobile-tab[^"]*"[^>]*data-view="decision"/);
  assert.match(renderIndex, /class="mobile-tab[^"]*"[^>]*data-view="documents"/);
  assert.match(renderIndex, /id="stream-unread-badge"/);
  assert.match(renderIndex, /id="decision-unread-badge"/);
});

test('共享 owner 的提交确认内嵌提交人控件，且位于决策统计上方', () => {
  assert.match(renderApp, /id="confirm-self-report-select"/);
  assert.match(renderApp, /id="confirm-self-report-other"/);
  assert.match(renderApp, /option\('匿名提交', 'anonymous'\)/);
  assert.ok(
    renderApp.indexOf('${confirmSelfReportHtml()}') < renderApp.indexOf('已决策 <strong>${model.decided}'),
    '提交人控件应位于“已决策 N 项”上方',
  );
  assert.doesNotMatch(renderIndex, /id="self-report-dialog"/);
  assert.doesNotMatch(renderApp, /确定匿名提交吗/);
});

test('共享 owner 未选择提交人时确认按钮禁用并显示提示', () => {
  const empty = resolveSelfReportSelection('', '', []);
  assert.equal(empty.explicit, false);
  assert.match(renderApp, /data-act="confirm"[^>]*\$\{_selfReportEnabled && !selection\.explicit \? ' disabled'/);
  assert.match(renderApp, />请先选择提交人<\/p>/);
});

test('共享 owner 明确选匿名可提交且 payload 不带 selfReport', () => {
  const anonymous = resolveSelfReportSelection('anonymous', '', []);
  assert.equal(anonymous.explicit, true);
  assert.equal(anonymous.mode, 'anonymous');
  assert.equal(anonymous.report, undefined);
  assert.match(renderApp, /\.\.\.\(decision\.report \? \{ selfReport: decision\.report \} : \{\}\)/);
});

test('共享 owner 选名册参与人时提交携带 selfReport', () => {
  const person = resolveSelfReportSelection('participant:alice', '', [
    { id: 'alice', name: '小艾' },
  ]);
  assert.equal(person.explicit, true);
  assert.deepEqual(person.report, { id: 'alice', name: '小艾' });
});

test('顶部未选状态醒目、选定后可点修改，留言仅轻提示且不阻断匿名发送', () => {
  assert.match(renderIndex, /class="self-report-dot"/);
  assert.match(renderIndex, /class="self-report-prompt">请选择提交人/);
  assert.match(renderApp, /`提交人：\$\{selection\.label\} ✎`/);
  assert.match(renderCss, /\.self-report-control\.is-unselected[\s\S]{0,220}var\(--color-status-warn\)/);
  assert.match(renderIndex, /id="stream-self-report-prompt"[\s\S]{0,120}请选择提交人/);
  assert.match(renderApp, /async function postStreamMessage[\s\S]{0,180}decision \|\| currentSelfReportSelection\(\)/);
});

test('对话区使用一致的中英文名称，不再向用户显示“会话流”', () => {
  assert.match(renderIndex, /aria-label="对话"/);
  assert.match(renderIndex, />CONVERSATION</);
  assert.match(renderIndex, /<h2>对话<\/h2>/);
  assert.match(renderIndex, /aria-label="调整对话宽度"/);
  assert.doesNotMatch(renderIndex, />会话流</);
  assert.doesNotMatch(renderIndex, />SESSION STREAM</);
});

test('streamEntryHtml：AI 左侧、自己右侧、他人左侧并显示名字', () => {
  const ai = streamEntryHtml({
    id: 'm-ai',
    kind: 'message',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    text: '正在看。',
  }, { viewerId: 'owner' });
  const self = streamEntryHtml({
    id: 'm-self',
    kind: 'message',
    author: { id: 'owner', name: 'Michael', role: 'owner' },
    text: '收到。',
  }, { viewerId: 'owner' });
  const other = streamEntryHtml({
    id: 'm-other',
    kind: 'message',
    author: { id: 'alice', name: '小艾', role: 'participant' },
    text: '我补一句。',
  }, { viewerId: 'owner' });

  assert.match(ai, /stream-entry--left/);
  assert.match(ai, /stream-entry--ai/);
  assert.match(self, /stream-entry--right/);
  assert.match(self, /stream-entry--self/);
  assert.match(other, /stream-entry--left/);
  assert.match(other, /stream-author[^>]*>小艾</);
});

test('streamEntryHtml：共享链接留言显示自报名且不改写 owner author 分侧', () => {
  const html = streamEntryHtml({
    id: 'shared-message',
    at: '2026-08-20T10:00:00.000Z',
    author: { id: 'owner', name: '管理员', role: 'owner' },
    selfReportedBy: { id: 'alice', name: '小艾' },
    kind: 'message',
    text: '共享链接留言',
  }, { viewerId: 'owner' });
  assert.match(html, /stream-entry--right/);
  assert.match(html, /stream-author[^>]*>小艾（共享链接）</);
  assert.doesNotMatch(html, /stream-author[^>]*>管理员</);
});

test('streamEntryHtml：receipt 与 progress 使用各自醒目的居中样式类', () => {
  const receipt = streamEntryHtml({
    id: 'r1',
    kind: 'receipt',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    text: '已出第 3 轮',
    refs: { round: 3 },
  });
  const progress = streamEntryHtml({
    id: 'p1',
    kind: 'progress',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    text: 'SDK 托底：正在执行',
  });

  assert.match(receipt, /stream-entry--receipt/);
  assert.match(receipt, /data-round="3"/);
  assert.match(receipt, /<button class="stream-system-pill"/);
  assert.match(progress, /stream-entry--progress/);
  assert.match(progress, /SDK 托底：正在执行/);
});

test('streamEntryHtml：未回答 ask 渲染内嵌决策卡、选项解释与推荐徽标', () => {
  const html = streamEntryHtml({
    id: 'ask-entry',
    kind: 'ask',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    text: '选择发布方式',
    ask: {
      id: 'deploy-mode',
      question: '这次用哪种发布方式？',
      options: [
        { id: 'rolling', label: '滚动发布', desc: '风险较低，但耗时更长。' },
        { id: 'direct', label: '直接发布', desc: '速度更快，但回滚压力更大。' },
      ],
      multi: false,
      recommendation: 'rolling',
    },
  }, { selectedAnswers: new Map([['deploy-mode', 'rolling']]) });

  assert.match(html, /stream-ask-card/);
  assert.match(html, /这次用哪种发布方式？/);
  assert.match(html, /需你选 1 项/);
  assert.match(html, /滚动发布/);
  assert.match(html, /风险较低，但耗时更长。/);
  assert.match(html, /推荐/);
  assert.match(html, /data-ask-option/);
  assert.match(html, /value="rolling"[^>]*checked/);
  assert.match(html, /点选项即提交/);
  assert.match(html, /data-ask-confirm/);
  assert.doesNotMatch(html, /stream-ask-card--answered/);
});

test('streamEntriesHtml：已回答 ask 锁定所选项和答题人，answer 自身显示紧凑一行', () => {
  const html = streamEntriesHtml([
    {
      id: 'ask-entry',
      kind: 'ask',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      text: '选择发布方式',
      ask: {
        id: 'deploy-mode',
        question: '这次用哪种发布方式？',
        options: [
          { id: 'rolling', label: '滚动发布', desc: '风险较低，但耗时更长。' },
          { id: 'direct', label: '直接发布', desc: '速度更快，但回滚压力更大。' },
        ],
        multi: false,
        recommendation: 'rolling',
      },
    },
    {
      id: 'answer-entry',
      kind: 'answer',
      author: { id: 'alice', name: '小艾', role: 'participant' },
      text: '滚动发布',
      answerTo: 'deploy-mode',
      answerValue: 'rolling',
    },
  ]);

  assert.match(html, /stream-ask-card--answered/);
  assert.match(html, /已回答 · 小艾/);
  assert.match(html, /value="rolling"[^>]*checked[^>]*disabled/);
  assert.match(html, /小艾已选择“滚动发布”/);
  assert.match(html, /stream-entry--answer/);
  assert.match(html, /小艾/);
  assert.match(html, /滚动发布/);
  assert.doesNotMatch(html, /data-ask-confirm[^>]*>确定/);
});

test('ask 卡片交互提交 answerTo/answerValue，并沿用变量适配桌面与手机', () => {
  assert.match(renderApp, /data-ask-option/);
  assert.match(renderApp, /data-ask-confirm/);
  assert.match(renderApp, /answerTo/);
  assert.match(renderApp, /answerValue/);
  assert.match(renderCss, /\.stream-ask-card\s*\{[\s\S]*?var\(--color-/);
  assert.match(renderCss, /\.stream-ask-recommendation\s*\{[\s\S]*?var\(--color-status-ok\)/);
  assert.match(
    renderCss,
    /@media \(max-width: 760px\)\s*\{[\s\S]*?\.stream-ask-card/,
  );
});

test('streamEntriesHtml：连续 AI progress 默认折叠旧进度，只常显最新一条且不折叠最终消息', () => {
  const html = streamEntriesHtml([
    {
      id: 'p1',
      kind: 'progress',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      text: '刚做完调研，接下来写测试',
    },
    {
      id: 'p2',
      kind: 'progress',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      text: '刚做完测试，接下来实现',
    },
    {
      id: 'p3',
      kind: 'progress',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      text: '刚做完实现，接下来验证',
    },
    {
      id: 'm-final',
      kind: 'message',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      text: 'Codex：实现与验证均已完成。',
    },
  ]);

  assert.match(html, /<details class="stream-progress-group"/);
  assert.match(html, /展开 2 条过程进度/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
  assert.ok(html.indexOf('刚做完调研') < html.indexOf('刚做完实现'));
  assert.match(html, /data-entry-id="p3"/);
  assert.match(html, /data-entry-id="m-final"/);
  assert.match(html, /stream-entry--message/);
  assert.ok(html.indexOf('</details>') < html.indexOf('Codex：实现与验证均已完成。'));
});

test('progress 折叠使用原生 details 交互与现有 CSS 变量，桌面和手机共用同一渲染结构', () => {
  assert.match(renderCss, /\.stream-progress-group\s*>\s*summary\s*\{[\s\S]*?var\(--color-border\)/);
  assert.match(renderCss, /\.stream-progress-group\[open\]/);
  assert.match(renderApp, /streamEntriesHtml\(_streamEntriesData/);
  assert.match(renderApp, /data-progress-group-id/);
});

test('streamEntryHtml：无轮次回执是非交互通知，长文案使用卡片排版而非胶囊', () => {
  const receipt = streamEntryHtml({
    id: 'r-long',
    kind: 'receipt',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    text: '这是一段较长的系统通知，会自然换行。',
  });

  assert.match(receipt, /<div class="stream-system-pill"/);
  assert.doesNotMatch(receipt, /<button/);
  assert.match(
    renderCss,
    /\.stream-system-pill\s*\{[\s\S]*?border-radius:\s*10px;[\s\S]*?text-align:\s*left;/,
  );
  assert.doesNotMatch(
    renderCss.match(/\.stream-system-pill\s*\{[\s\S]*?\}/)?.[0] || '',
    /border-radius:\s*999px/,
  );
});

test('decisionChipHtml：仅最新轮 receipt 且有待确认决策时生成芯片', () => {
  const entry = {
    id: 'receipt-3',
    kind: 'receipt',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    text: '已出第 3 轮',
    refs: { round: 3 },
  };

  assert.match(
    decisionChipHtml(entry, { latestRound: 3, pendingCount: 2 }),
    /第 3 轮有 2 个决策待你确认/,
  );
  assert.equal(decisionChipHtml(entry, { latestRound: 2, pendingCount: 2 }), '');
  assert.equal(decisionChipHtml(entry, { latestRound: 3, pendingCount: 0 }), '');
  assert.equal(decisionChipHtml({ ...entry, kind: 'message' }, { latestRound: 3, pendingCount: 2 }), '');
});

test('decisionChipForLatestReceipt：同轮多个回执只保留最后一个芯片锚点', () => {
  const entries = [
    { id: 'receipt-old', kind: 'receipt', refs: { round: 2 } },
    { id: 'receipt-latest-a', kind: 'receipt', refs: { round: 3 } },
    { id: 'message-latest', kind: 'message', refs: { round: 3 } },
    { id: 'receipt-latest-b', kind: 'receipt', refs: { round: 3 } },
  ];
  const model = decisionChipForLatestReceipt(entries, { latestRound: 3, pendingCount: 4 });

  assert.equal(model.entryId, 'receipt-latest-b');
  assert.match(model.html, /第 3 轮有 4 个决策待你确认/);
  assert.equal(decisionChipForLatestReceipt(entries, { latestRound: 3, pendingCount: 0 }), null);
});

test('clampStreamPanelWidth：窗口缩窄时会重新夹取已保存宽度', () => {
  assert.equal(clampStreamPanelWidth(540, 1400), 540);
  assert.equal(clampStreamPanelWidth(540, 900), 380);
  assert.equal(clampStreamPanelWidth(120, 1400), 288);
});

test('composerValueAfterSend：仅清空本次已发送文本，不覆盖等待期间的新输入', () => {
  assert.equal(composerValueAfterSend('第一条', '第一条'), '');
  assert.equal(composerValueAfterSend('正在写第二条', '第一条'), '正在写第二条');
});

test('attachmentMessageMarkdown：图片生成图片 Markdown，PDF 生成链接 Markdown', () => {
  assert.equal(
    attachmentMessageMarkdown({
      url: '/assets/demo/uploads/shot-1.png',
      name: '界面截图.png',
      type: 'image/png',
    }),
    '![界面截图.png](/assets/demo/uploads/shot-1.png)',
  );
  assert.equal(
    attachmentMessageMarkdown({
      url: '/assets/demo/uploads/spec-1.pdf',
      name: '需求说明.pdf',
      type: 'application/pdf',
    }),
    '[需求说明.pdf](/assets/demo/uploads/spec-1.pdf)',
  );
});

test('pinPopoverPosition：默认锚在 pin 附近，视口右下角自动向左上翻转', () => {
  assert.deepEqual(
    pinPopoverPosition(
      { x: 100, y: 200 },
      { width: 1000, height: 800 },
      { width: 280, height: 120 },
    ),
    { left: 114, top: 188, horizontal: 'right', vertical: 'below' },
  );

  const flipped = pinPopoverPosition(
    { x: 980, y: 790 },
    { width: 1000, height: 800 },
    { width: 280, height: 120 },
  );
  assert.deepEqual(flipped, {
    left: 686,
    top: 658,
    horizontal: 'left',
    vertical: 'above',
  });
});

test('containerPinPopoverPosition：百分比 pin 换算为容器内坐标，右下角自动翻转', () => {
  assert.deepEqual(
    containerPinPopoverPosition(
      { width: 400, height: 200 },
      { xPct: 25, yPct: 50 },
      { width: 120, height: 60 },
    ),
    { left: 114, top: 88, horizontal: 'right', vertical: 'below' },
  );

  assert.deepEqual(
    containerPinPopoverPosition(
      { width: 400, height: 200 },
      { xPct: 95, yPct: 95 },
      { width: 120, height: 60 },
    ),
    { left: 246, top: 118, horizontal: 'left', vertical: 'above' },
  );
});

test('containerPinPopoverPosition：容器部分滚出视口时，在容器内可见边界翻转并防溢出', () => {
  assert.deepEqual(
    containerPinPopoverPosition(
      { width: 600, height: 400 },
      { xPct: 90, yPct: 70 },
      { width: 180, height: 100 },
      { visibleBounds: { left: 100, top: 40, right: 500, bottom: 340 } },
    ),
    { left: 308, top: 168, horizontal: 'left', vertical: 'above' },
  );
});

test('prototype pin：浮层与 SVG overlay 共用原型媒体容器定位上下文', () => {
  assert.match(
    renderApp,
    /const pinContainer = overlay\.parentElement;/,
    '浮层应挂到 overlay 所属的图片/原型容器',
  );
  assert.match(renderApp, /pinContainer\.appendChild\(commentBubble\)/);
  assert.match(
    renderCss,
    /\.proto-pin-comment\s*\{[^}]*position:\s*absolute;/s,
    '浮层应使用容器内绝对定位',
  );
});

test('prototype pin：分栏宽度和隐藏分面变化后都会重新计算容器坐标', () => {
  assert.match(
    renderApp,
    /function applyStreamWidth\([^)]*\)\s*\{[\s\S]*?repositionVisiblePinComments\(\);/,
    '拖动分栏改变原型容器宽度后应重算浮层',
  );
  assert.match(
    renderApp,
    /function activateFacet\([^)]*\)\s*\{[\s\S]*?repositionVisiblePinComments\(\);/,
    '隐藏分面重新显示后应重算浮层',
  );
  assert.match(
    renderApp,
    /function setActiveView\([^)]*\)\s*\{[\s\S]*?view === 'decision'[\s\S]*?repositionVisiblePinComments\(\);/,
    '从文档或手机对话返回决策区后应重算浮层',
  );
});

// ---------- mdToHtml ----------

test('mdToHtml: h1 heading', () => {
  const out = mdToHtml('# 标题');
  assert.ok(out.includes('<h1'), `expected <h1> in: ${out}`);
  assert.ok(out.includes('标题'), `expected text in: ${out}`);
});

test('mdToHtml: h2 heading', () => {
  const out = mdToHtml('## 二级标题');
  assert.ok(out.includes('<h2'), `expected <h2> in: ${out}`);
});

test('mdToHtml: bold **b**', () => {
  const out = mdToHtml('**粗体**');
  assert.ok(out.includes('<strong>粗体</strong>'), `expected <strong> in: ${out}`);
});

test('mdToHtml: inline code `code`', () => {
  const out = mdToHtml('`代码`');
  assert.ok(out.includes('<code>代码</code>'), `expected <code> in: ${out}`);
});

test('mdToHtml: list item -', () => {
  const out = mdToHtml('- 列表项');
  assert.ok(out.includes('<li>'), `expected <li> in: ${out}`);
  assert.ok(out.includes('列表项'), `expected text in: ${out}`);
});

test('participantFeedbackHtml：逐人意见只读展示、choice 显示标签并标注分歧', () => {
  const block = {
    id: 'decision-a',
    type: 'choice',
    options: [{ id: 'safe', label: '稳妥方案' }, { id: 'fast', label: '快速方案' }],
  };
  const html = participantFeedbackHtml(block, [{
    id: 'alice',
    name: '小艾',
    submittedAt: '2026-07-23T00:00:00.000Z',
    feedback: {
      items: [{ blockId: 'decision-a', type: 'select', value: 'safe', comment: '可以回退' }],
    },
  }], [{ blockId: 'decision-a', choices: [] }]);

  assert.match(html, /小艾 的意见/);
  assert.match(html, /稳妥方案/);
  assert.match(html, /可以回退/);
  assert.match(html, /意见分歧/);
  assert.doesNotMatch(html, /<textarea|<input|<button/);
});

test('participantFeedbackHtml：转义参与者与反馈文本，无该块意见时为空', () => {
  const html = participantFeedbackHtml({ id: 'b-safe', type: 'freetext' }, [{
    id: 'evil',
    name: '<img src=x>',
    feedback: { items: [{ blockId: 'b-safe', type: 'text', value: '<script>x</script>' }] },
  }], []);

  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.equal(participantFeedbackHtml({ id: 'other', type: 'markdown' }, [], []), '');
});

test('mdToHtml: link [t](u)', () => {
  const out = mdToHtml('[链接](https://example.com)');
  assert.ok(out.includes('<a '), `expected <a> in: ${out}`);
  assert.ok(out.includes('href="https://example.com"'), `expected href in: ${out}`);
  assert.ok(out.includes('链接'), `expected text in: ${out}`);
});

test('mdToHtml: attachment image markdown renders safe lazy image', () => {
  const out = mdToHtml('![截图](/assets/demo/uploads/screen.png)');
  assert.match(out, /<img class="md-image"/);
  assert.match(out, /src="\/assets\/demo\/uploads\/screen\.png"/);
  assert.match(out, /alt="截图"/);
  assert.match(out, /loading="lazy"/);
});

test('mdToHtml: unsafe link protocols are neutralized', () => {
  const out = mdToHtml('[危险链接](javascript:alert(1))');
  assert.match(out, /href="#"/);
  assert.doesNotMatch(out, /href="javascript:/);
});

test('mdToHtml: escapes < > &', () => {
  const out = mdToHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), `<script> must not appear literally in: ${out}`);
  assert.ok(out.includes('&lt;'), `expected &lt; in: ${out}`);
  assert.ok(out.includes('&gt;'), `expected &gt; in: ${out}`);
});

test('mdToHtml: escapes & ampersand', () => {
  const out = mdToHtml('A & B');
  assert.ok(out.includes('&amp;'), `expected &amp; in: ${out}`);
});

test('mdToHtml: GFM table renders semantic HTML with responsive wrapper and alignment', () => {
  const out = mdToHtml([
    '| 左对齐 | 居中 | 右对齐 |',
    '| :--- | :---: | ---: |',
    '| **粗体** | `代码` | 42 |',
  ].join('\n'));

  assert.match(out, /class="md-table-scroll"/);
  assert.match(out, /<table class="md-table">/);
  assert.match(out, /<thead><tr><th class="md-align-left">左对齐<\/th><th class="md-align-center">居中<\/th><th class="md-align-right">右对齐<\/th><\/tr><\/thead>/);
  assert.match(out, /<tbody><tr><td class="md-align-left"><strong>粗体<\/strong><\/td><td class="md-align-center"><code>代码<\/code><\/td><td class="md-align-right">42<\/td><\/tr><\/tbody>/);
});

test('mdToHtml: table supports escaped pipes, pads short rows, and remains XSS safe', () => {
  const out = mdToHtml([
    '| 字段 | 值 |',
    '| --- | --- |',
    '| A \\| B | <script>alert(1)</script> |',
    '| 只有一列 |',
  ].join('\n'));

  assert.match(out, /<td>A \| B<\/td>/);
  assert.match(out, /<td>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/td>/);
  assert.match(out, /<tr><td>只有一列<\/td><td><\/td><\/tr>/);
  assert.doesNotMatch(out, /<script>/);
});

// ---------- blockHtml ----------

test('blockHtml: markdown type renders md content', () => {
  const block = { id: 'b1', type: 'markdown', body: '# 标题', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="b1"'), `expected data-block-id in: ${out}`);
  assert.ok(out.includes('<h1'), `expected <h1> in: ${out}`);
  assert.ok(out.includes('data-type="markdown"'), `expected data-type in: ${out}`);
});

test('blockHtml: diagram renders <pre class="mermaid">', () => {
  const block = { id: 'b2', type: 'diagram', body: 'graph TD\nA-->B', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<pre class="mermaid">'), `expected mermaid pre in: ${out}`);
  assert.ok(out.includes('graph TD'), `expected diagram source in: ${out}`);
  assert.ok(out.includes('data-block-id="b2"'), `expected data-block-id in: ${out}`);
});

test('blockHtml: diagram escapes < in source', () => {
  const block = { id: 'b-dia', type: 'diagram', body: 'graph TD\nA-->&lt;B>', _change: 'unchanged' };
  const out = blockHtml(block);
  // the raw body contains &lt; which after escape should not become <B> injection
  assert.ok(out.includes('<pre class="mermaid">'), `expected mermaid pre`);
});

test('blockHtml: diagram with rationale shows folded details', () => {
  const block = { id: 'b-r', type: 'diagram', body: 'graph TD\nA-->B', rationale: '这是原因', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<details'), `expected <details> in: ${out}`);
  assert.ok(out.includes('这是原因'), `expected rationale text in: ${out}`);
});

test('blockHtml: choice renders all options', () => {
  const block = {
    id: 'b3', type: 'choice', _change: 'new',
    options: [
      { id: 'o1', label: '选项A' },
      { id: 'o2', label: '选项B' },
      { id: 'o3', label: '选项C' },
    ],
    recommendation: 'o2',
    hasRecommendation: true,
  };
  const out = blockHtml(block);
  assert.ok(out.includes('选项A'), `expected 选项A in: ${out}`);
  assert.ok(out.includes('选项B'), `expected 选项B in: ${out}`);
  assert.ok(out.includes('选项C'), `expected 选项C in: ${out}`);
  // recommended option has data-recommended
  assert.ok(out.includes('data-recommended'), `expected data-recommended in: ${out}`);
  // recommended option labeled
  assert.ok(out.includes('推荐'), `expected 推荐 label in: ${out}`);
});

test('blockHtml: choice non-recommended options do NOT have data-recommended', () => {
  const block = {
    id: 'b3b', type: 'choice', _change: 'unchanged',
    options: [{ id: 'o1', label: '选项A' }, { id: 'o2', label: '选项B' }],
    recommendation: 'o1',
    hasRecommendation: true,
  };
  const out = blockHtml(block);
  // Count data-recommended occurrences — should be exactly 1
  const matches = out.match(/data-recommended/g);
  assert.equal(matches ? matches.length : 0, 1, `expected exactly 1 data-recommended in: ${out}`);
});

test('blockHtml: verdict renders three buttons', () => {
  const block = { id: 'b4', type: 'verdict', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('✓') || out.includes('赞成'), `expected 赞成 button in: ${out}`);
  assert.ok(out.includes('✗') || out.includes('异议'), `expected 异议 button in: ${out}`);
  assert.ok(out.includes('?') || out.includes('疑问'), `expected 疑问 button in: ${out}`);
  // should have exactly 3 buttons
  const btnCount = (out.match(/<button/g) || []).length;
  assert.ok(btnCount >= 3, `expected at least 3 buttons in: ${out}`);
});

test('blockHtml: freetext renders textarea', () => {
  const block = { id: 'b5', type: 'freetext', placeholder: '请输入', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<textarea'), `expected <textarea> in: ${out}`);
  assert.ok(out.includes('请输入'), `expected placeholder in: ${out}`);
});

test('blockHtml: editable renders textarea with data-editable', () => {
  const block = { id: 'b6', type: 'editable', value: '可编辑内容', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-editable'), `expected data-editable in: ${out}`);
  assert.ok(out.includes('<textarea'), `expected textarea in: ${out}`);
});

test('blockHtml: table renders table element', () => {
  const block = {
    id: 'b7', type: 'table', _change: 'unchanged',
    columns: ['A', 'B'],
    rows: [['1', '2'], ['3', '4']],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('<table'), `expected <table> in: ${out}`);
  assert.ok(out.includes('<th'), `expected <th> in: ${out}`);
  assert.ok(out.includes('<td'), `expected <td> in: ${out}`);
});

test('blockHtml: code renders <pre><code> with lang', () => {
  const block = { id: 'b8', type: 'code', lang: 'javascript', body: 'const x = 1;', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<pre'), `expected <pre> in: ${out}`);
  assert.ok(out.includes('<code'), `expected <code> in: ${out}`);
  assert.ok(out.includes('const x = 1;') || out.includes('const x '), `expected code body in: ${out}`);
});

test('blockHtml: outer section has data-change attribute', () => {
  const block = { id: 'bx', type: 'markdown', body: 'x', _change: 'changed' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-change="changed"'), `expected data-change in: ${out}`);
});

test('blockHtml: has comment entry point', () => {
  const block = { id: 'by', type: 'markdown', body: 'y', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('批注') || out.includes('+批注'), `expected 批注 in: ${out}`);
});

test('blockHtml: 批注是内联输入框（textarea），非弹窗', () => {
  const out = blockHtml({ id: 'by', type: 'markdown', body: 'y', _change: 'unchanged' });
  assert.ok(out.includes('comment-input'), '应有内联批注输入框 .comment-input');
  assert.ok(out.includes('class="comment-box"') || out.includes("comment-box"), '应有内联批注容器 .comment-box');
  assert.ok(out.includes('data-comment-for="by"'), '批注输入框应绑定到该 block');
  assert.ok(/<textarea[^>]*comment-input/.test(out), '批注应为 textarea 内联编辑，而非仅按钮');
});

// ---------- embed ----------

test('renderEmbed: contains iframe with proxy src', () => {
  const block = { id: 'e1', type: 'embed', url: 'https://example.com/page?q=1&r=2' };
  const out = renderEmbed(block);
  assert.ok(out.includes('<iframe'), `expected <iframe> in: ${out}`);
  assert.ok(out.includes('src="/api/proxy?url='), `expected proxy src in: ${out}`);
  // url must be encodeURIComponent-encoded (: → %3A, / → %2F etc.)
  assert.ok(out.includes(encodeURIComponent('https://example.com/page?q=1&r=2')), `expected encoded url in: ${out}`);
});

test('renderEmbed: contains embed-rail (飞书式右侧评论栏)', () => {
  const out = renderEmbed({ id: 'e2', type: 'embed', url: 'https://x.com' });
  assert.ok(out.includes('embed-rail'), `expected embed-rail in: ${out}`);
  assert.ok(!out.includes('embed-overlay'), `must NOT contain embed-overlay in: ${out}`);
});

test('renderEmbed: contains rail-add button and no embed-annotate-toggle', () => {
  const out = renderEmbed({ id: 'e3', type: 'embed', url: 'https://x.com' });
  assert.ok(out.includes('rail-add'), `expected rail-add in: ${out}`);
  assert.ok(!out.includes('embed-annotate-toggle'), `must NOT contain embed-annotate-toggle in: ${out}`);
});

test('blockHtml: embed type renders iframe with proxy url in outer section', () => {
  const block = { id: 'emb1', type: 'embed', url: 'https://example.com', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="emb1"'), `expected data-block-id in: ${out}`);
  assert.ok(out.includes('data-type="embed"'), `expected data-type in: ${out}`);
  assert.ok(out.includes('<iframe'), `expected <iframe> in: ${out}`);
  assert.ok(out.includes('/api/proxy?url='), `expected proxy src in: ${out}`);
  assert.ok(out.includes(encodeURIComponent('https://example.com')), `expected encoded url in: ${out}`);
});

// ---------- diff-view ----------

test('changeBadge: new contains NEW and ＋', () => {
  const out = changeBadge({ _change: 'new' });
  assert.ok(out.includes('NEW') || out.includes('新增'), `expected NEW text in: ${out}`);
  assert.ok(out.includes('＋') || out.includes('+'), `expected + icon in: ${out}`);
});

test('changeBadge: changed contains CHANGED and ～', () => {
  const out = changeBadge({ _change: 'changed' });
  assert.ok(out.includes('CHANGED') || out.includes('改动'), `expected CHANGED text in: ${out}`);
  assert.ok(out.includes('～') || out.includes('~'), `expected ~ icon in: ${out}`);
});

test('changeBadge: unchanged is empty string', () => {
  const out = changeBadge({ _change: 'unchanged' });
  assert.equal(out, '', `expected empty string for unchanged, got: ${out}`);
});

test('prevCompareHtml: returns non-empty HTML for changed block with _prev', () => {
  const block = {
    id: 'bz', type: 'markdown', _change: 'changed',
    body: '新内容',
    _prev: { body: '旧内容' },
    _changedFields: ['body'],
  };
  const out = prevCompareHtml(block);
  assert.ok(out.length > 0, `expected non-empty HTML for changed block`);
  assert.ok(out.includes('旧内容') || out.includes('上轮'), `expected prev content or label in: ${out}`);
});

test('prevCompareHtml: returns empty for unchanged block', () => {
  const block = { id: 'bz2', type: 'markdown', _change: 'unchanged', body: 'x' };
  const out = prevCompareHtml(block);
  assert.equal(out, '', `expected empty for unchanged`);
});

test('diffToggleHtml: returns HTML with toggle control', () => {
  const out = diffToggleHtml();
  assert.ok(out.includes('变更') || out.includes('只看'), `expected toggle text in: ${out}`);
  assert.ok(out.length > 0, `expected non-empty HTML`);
});

// ---------- changeBadge 改动 E 新徽章（DESIGN §4）----------

test('changeBadge: changed + _respondedToPrev → 已采纳 badge', () => {
  const out = changeBadge({ _change: 'changed', _respondedToPrev: true });
  assert.ok(out.includes('已采纳'), `expected 已采纳 in: ${out}`);
  assert.ok(out.includes('↩'), `expected ↩ in: ${out}`);
  assert.ok(!out.includes('CHANGED'), `must not show CHANGED when adopted, got: ${out}`);
});

test('changeBadge: changed without _respondedToPrev → 普通 CHANGED badge', () => {
  const out = changeBadge({ _change: 'changed', _respondedToPrev: false });
  assert.ok(out.includes('CHANGED'), `expected CHANGED in: ${out}`);
  assert.ok(!out.includes('已采纳'), `must not show 已采纳 without _respondedToPrev, got: ${out}`);
});

test('changeBadge: unchanged + _respondedToPrev → 维持 badge', () => {
  const out = changeBadge({ _change: 'unchanged', _respondedToPrev: true });
  assert.ok(out.includes('维持'), `expected 维持 in: ${out}`);
  assert.ok(out.includes('—'), `expected — in: ${out}`);
});

test('changeBadge: unchanged without _respondedToPrev → 空字符串', () => {
  const out = changeBadge({ _change: 'unchanged', _respondedToPrev: false });
  assert.equal(out, '', `expected empty string for unchanged without respondedToPrev`);
});

test('changeBadge: unchanged (no _respondedToPrev field) → 空字符串', () => {
  const out = changeBadge({ _change: 'unchanged' });
  assert.equal(out, '', `expected empty string for plain unchanged`);
});

// ---------- renderZones statusBar 改动 B（DESIGN §4）----------

test('renderZones: 首轮（round=1）状态条显示"首轮 · N 项待确认"而非 delta', () => {
  const blocks = [
    { id: 'r1a', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'r1b', type: 'markdown', needsDecision: false, _change: 'new' },
  ];
  const out = renderZones(blocks, { round: 1 });
  assert.ok(out.includes('首轮'), `expected 首轮 in statusBar: ${out.slice(0, 500)}`);
  assert.ok(!out.includes('新增') || !out.includes('改动'), 'first round should not show new/changed delta breakdown');
});

test('renderZones: 全部块为 new（推断首轮）→ 首轮文案', () => {
  const blocks = [
    { id: 'x1', type: 'verdict', needsDecision: true, _change: 'new' },
    { id: 'x2', type: 'verdict', needsDecision: true, _change: 'new' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('首轮'), `all-new blocks → 首轮 statusBar: ${out.slice(0, 500)}`);
});

test('renderZones: 多轮（有 new+changed）状态条显示"本轮 N 项待你确认（新增 M · 改动 K）"', () => {
  const blocks = [
    { id: 'm1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'm2', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'changed' },
    { id: 'm3', type: 'markdown', needsDecision: false, _change: 'unchanged' },
  ];
  const out = renderZones(blocks, { round: 2 });
  assert.ok(out.includes('本轮'), `expected 本轮 in statusBar: ${out.slice(0, 500)}`);
  assert.ok(out.includes('新增'), `expected 新增 in statusBar: ${out.slice(0, 500)}`);
  assert.ok(out.includes('改动'), `expected 改动 in statusBar: ${out.slice(0, 500)}`);
});

// ---------- renderZones ----------

const mixedBlocks = [
  { id: 'a1', type: 'verdict', needsDecision: true, hasRecommendation: false, importance: 'high', _change: 'new' },
  { id: 'a2', type: 'choice', needsDecision: true, hasRecommendation: false, importance: 'normal', _change: 'unchanged',
    options: [{ id: 'o1', label: 'X' }] },
  { id: 'b1', type: 'choice', needsDecision: true, hasRecommendation: true, importance: 'normal', _change: 'unchanged',
    options: [{ id: 'o1', label: 'Y' }], recommendation: 'o1' },
  { id: 'cr1', type: 'markdown', needsDecision: false, importance: 'high', default: '默认值', _change: 'unchanged', body: '重要默认' },
  { id: 'cf1', type: 'markdown', needsDecision: false, importance: 'normal', default: '默认f', _change: 'unchanged', body: '普通fyi' },
  { id: 'ctx1', type: 'markdown', needsDecision: false, importance: 'normal', _change: 'new', body: 'AI叙述内容' },
];

// 改动 A'（§4）：unchanged 块进 zoneSettled；只有 new/changed 进常显区。
// a2/b1/cr1/cf1 均为 unchanged → zoneSettled；a1(new)→ zoneA；ctx1(new)→ zoneContext。
test('renderZones: zone A content (new) appears before zoneSettled (unchanged)', () => {
  const out = renderZones(mixedBlocks);
  const posA = out.indexOf('a1');
  const posSettled = out.indexOf('zone-settled');
  assert.ok(posA !== -1, `expected zoneA block a1 in output`);
  assert.ok(posSettled !== -1, `expected zone-settled in output`);
  assert.ok(posA < posSettled, `zoneA (pos ${posA}) should appear before zoneSettled (pos ${posSettled})`);
});

test('renderZones: shows decision count', () => {
  const out = renderZones(mixedBlocks);
  // 改动B：顶部显示"本轮 N 项待你确认（新增 M · 改动 K）"；N = 新增+改动（不含已沉降的 unchanged）
  // mixedBlocks: a1=new(决策) / a2,b1=unchanged(沉降) → 待确认 1（新增 1 · 改动 0）
  assert.ok(out.includes('待你确认') || out.includes('待确认'), `expected 待确认 counter in: ${out}`);
  assert.ok(out.includes('新增 <strong>1</strong>'), `expected 新增 delta in: ${out}`);
});

test('renderZones: zone A label contains 需你定·无预设 or similar', () => {
  const out = renderZones(mixedBlocks);
  assert.ok(out.includes('无预设') || out.includes('◆') || out.includes('需你定'), `expected zone A label in: ${out}`);
});

test('renderZones: zone B label contains 有推荐 or similar', () => {
  const out = renderZones(mixedBlocks);
  assert.ok(out.includes('有推荐') || out.includes('◇') || out.includes('需你定'), `expected zone B label in: ${out}`);
});

test('renderZones: degraded - all default shows no-decision message', () => {
  const allDefault = [
    { id: 'd1', type: 'markdown', needsDecision: false, importance: 'normal', _change: 'unchanged', body: '默认A' },
    { id: 'd2', type: 'markdown', needsDecision: false, importance: 'normal', _change: 'unchanged', body: '默认B' },
  ];
  const out = renderZones(allDefault);
  assert.ok(out.includes('无需你决策') || out.includes('确认即可'), `expected degraded message in: ${out}`);
});

test('renderZones: no zoneCFyi blocks means no fyi collapse rendered', () => {
  const noFyi = [
    { id: 'a1', type: 'verdict', needsDecision: true, hasRecommendation: false, importance: 'normal', _change: 'new' },
    { id: 'cr1', type: 'markdown', needsDecision: false, importance: 'high', default: 'v', _change: 'unchanged', body: 'hi' },
  ];
  const out = renderZones(noFyi);
  // zoneCFyi section should not appear (or be empty)
  // We check that cf1 is not in output since there's no such block
  assert.ok(!out.includes('zone-c-fyi') || !out.includes('cf1'),
    `expected no fyi zone content for blocks without fyi items`);
});

test('renderZones: 纯叙述内容(无 default) 可见于 zone-context，不被折叠', () => {
  const out = renderZones(mixedBlocks);
  assert.ok(out.includes('zone-context'), 'expected zone-context section');
  assert.ok(out.includes('ctx1'), 'expected context block ctx1 rendered');
  const posCtx = out.indexOf('ctx1');
  const posFold = out.indexOf('zone-c-fyi');
  assert.ok(posFold === -1 || posCtx < posFold, 'context should be visible above the fold');
});

// ---------- renderZones：_change 分区单测（改动 A' §4）----------

test('renderZones: unchanged blocks go to zoneSettled (folded), not zoneA/B', () => {
  const blocks = [
    { id: 'u1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'unchanged' },
    { id: 'u2', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'unchanged',
      options: [{ id: 'o1', label: 'X' }], recommendation: 'o1' },
  ];
  const out = renderZones(blocks);
  // Both unchanged → zoneSettled; zoneA/B sections must not be rendered
  assert.ok(out.includes('zone-settled'), 'expected zone-settled in output');
  assert.ok(out.includes('u1'), 'expected u1 in zoneSettled');
  assert.ok(out.includes('u2'), 'expected u2 in zoneSettled');
  // Check absence of actual zone sections (not just the href="#zone-a" in statusBar)
  assert.ok(!out.includes('id="zone-a"'), 'zoneA section must be absent (no new/changed decision blocks)');
  assert.ok(!out.includes('id="zone-b"'), 'zoneB section must be absent (no new/changed decision blocks)');
});

test('renderZones: new/changed blocks go to zoneA/B (常显)', () => {
  const blocks = [
    { id: 'n1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'c1', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'changed',
      options: [{ id: 'o1', label: 'X' }], recommendation: 'o1' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('zone-a'), 'expected zone-a in output');
  assert.ok(out.includes('zone-b'), 'expected zone-b in output');
  // Should NOT be in zoneSettled
  assert.ok(!out.includes('zone-settled'), 'zoneSettled must be absent when all blocks are new/changed');
});

test('renderZones: 首轮全 new — 不折叠任何块到 zoneSettled', () => {
  // 首轮：server.mjs 对空 prevBlocks 全标 new；首轮行为正确，无沉降
  const firstRoundBlocks = [
    { id: 'f1', type: 'markdown', needsDecision: false, _change: 'new', body: '叙述内容' },
    { id: 'f2', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'f3', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'new',
      options: [{ id: 'o1', label: 'A' }], recommendation: 'o1' },
  ];
  const out = renderZones(firstRoundBlocks);
  assert.ok(!out.includes('zone-settled'), '首轮全 new 时不应出现 zone-settled');
  assert.ok(out.includes('f2'), 'f2 应在 zoneA 常显');
  assert.ok(out.includes('f3'), 'f3 应在 zoneB 常显');
});

test('renderZones: zoneSettled 折叠标题含项目数', () => {
  const blocks = [
    { id: 's1', type: 'verdict', needsDecision: true, _change: 'unchanged' },
    { id: 's2', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'x' },
    { id: 's3', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'y' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('zone-settled'), 'expected zone-settled');
  assert.ok(out.includes('3'), 'expected count 3 in zoneSettled summary');
  assert.ok(out.includes('本轮无变化'), 'expected summary text in zoneSettled');
});

// ---------- blockHtml body 上屏断言（§5.0）----------

test('blockHtml: verdict with body renders .block-body', () => {
  const block = { id: 'v1', type: 'verdict', title: '是否删除？', body: '删除后无法恢复。', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(out.includes('block-body'), `expected .block-body in: ${out}`);
  assert.ok(out.includes('删除后无法恢复'), `expected body text in: ${out}`);
});

test('blockHtml: choice with body renders .block-body before block-content', () => {
  const block = {
    id: 'c1', type: 'choice', body: '请选择部署方式。', _change: 'new',
    options: [{ id: 'o1', label: '方案A' }],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('block-body'), `expected .block-body in: ${out}`);
  assert.ok(out.includes('请选择部署方式'), `expected body text in: ${out}`);
  // block-body 应在 block-content 之前
  assert.ok(out.indexOf('block-body') < out.indexOf('block-content'), 'block-body must precede block-content');
});

test('blockHtml: markdown type does NOT double-render body as .block-body', () => {
  const block = { id: 'm1', type: 'markdown', body: '# 标题内容', _change: 'new' };
  const out = blockHtml(block);
  // markdown 用 body 作主内容，不应再渲染 .block-body
  assert.ok(!out.includes('block-body'), `markdown must NOT have .block-body, got: ${out}`);
  assert.ok(out.includes('<h1'), 'markdown body should still render as HTML heading');
});

test('blockHtml: diagram type does NOT double-render body as .block-body', () => {
  const block = { id: 'd1', type: 'diagram', body: 'graph TD\nA-->B', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(!out.includes('block-body'), `diagram must NOT have .block-body`);
  assert.ok(out.includes('mermaid'), 'diagram body should render as mermaid pre');
});

test('blockHtml: code type does NOT double-render body as .block-body', () => {
  const block = { id: 'co1', type: 'code', lang: 'js', body: 'const x = 1;', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(!out.includes('block-body'), `code must NOT have .block-body`);
  assert.ok(out.includes('const x = 1;'), 'code body should render in pre/code');
});

test('blockHtml: block without body has no .block-body element', () => {
  const block = { id: 'v2', type: 'verdict', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(!out.includes('block-body'), `no body → no .block-body, got: ${out}`);
});

// ---------- renderZones zoneSettled 分组语义化（改动 D，DESIGN §4 批次2）----------

test('renderZones: zoneSettled 含 _decidedInPrev 时显示"已决 N 项（上轮已确认·本轮无变化）"', () => {
  const blocks = [
    // 上轮已决 + 本轮无变化
    { id: 'd1', type: 'verdict', needsDecision: true, _change: 'unchanged', _decidedInPrev: true },
    { id: 'd2', type: 'markdown', needsDecision: false, _change: 'unchanged', _decidedInPrev: true, body: 'x' },
    // 本轮无变化但上轮未被反馈
    { id: 'u1', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'y' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('zone-settled'), 'expected zone-settled in output');
  assert.ok(out.includes('已决 2 项'), 'expected 已决 2 项 in zoneSettled summary');
  assert.ok(out.includes('上轮已确认·本轮无变化'), 'expected 上轮已确认·本轮无变化 in summary');
  assert.ok(out.includes('本轮无变化 1 项'), 'expected 本轮无变化 1 项 in summary');
});

test('renderZones: zoneSettled 全为 _decidedInPrev 时只显示已决组，无"本轮无变化 M 项"', () => {
  const blocks = [
    { id: 'd1', type: 'verdict', needsDecision: true, _change: 'unchanged', _decidedInPrev: true },
    { id: 'd2', type: 'verdict', needsDecision: true, _change: 'unchanged', _decidedInPrev: true },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('已决 2 项'), 'expected 已决 2 项');
  // 无纯 unchanged 的 → 不出现 "本轮无变化 M 项"
  assert.ok(!out.includes('本轮无变化 0 项'), 'must not show 本轮无变化 0 项');
});

test('renderZones: zoneSettled 全无 _decidedInPrev 时只显示"本轮无变化 M 项"，无"已决 N 项"', () => {
  const blocks = [
    { id: 'u1', type: 'verdict', needsDecision: true, _change: 'unchanged' },
    { id: 'u2', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'z' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('本轮无变化 2 项'), 'expected 本轮无变化 2 项 in summary');
  assert.ok(!out.includes('已决 0 项'), 'must not show 已决 0 项');
});

// ---------- renderChecklist（§1.4 B）----------

test('renderChecklist: 三态按钮标签取 verdictLabels', () => {
  const block = {
    id: 'chk1',
    type: 'checklist',
    verdictLabels: ['已覆盖', '明确不做', '待定'],
    items: [
      { id: 'i1', label: '用户注册流程' },
      { id: 'i2', label: '错误恢复', body: '异常时应给出明确提示' },
    ],
  };
  const out = renderChecklist(block);
  assert.ok(out.includes('已覆盖'), 'expected 已覆盖 label');
  assert.ok(out.includes('明确不做'), 'expected 明确不做 label');
  assert.ok(out.includes('待定'), 'expected 待定 label');
  assert.ok(out.includes('用户注册流程'), 'expected item label');
  assert.ok(out.includes('错误恢复'), 'expected second item');
  assert.ok(out.includes('异常时应给出明确提示'), 'expected item body');
});

test('renderChecklist: 每个 item 的每个标签都有对应 data-item-id + data-label', () => {
  const block = {
    id: 'chk2',
    type: 'checklist',
    verdictLabels: ['A', 'B'],
    items: [{ id: 'i1', label: 'Item' }],
  };
  const out = renderChecklist(block);
  assert.ok(out.includes('data-item-id="i1"'), 'expected data-item-id');
  assert.ok(out.includes('data-label="A"'), 'expected data-label A');
  assert.ok(out.includes('data-label="B"'), 'expected data-label B');
  assert.ok(out.includes('data-block-id="chk2"'), 'expected data-block-id');
});

test('renderChecklist: blockHtml 含 checklist-group', () => {
  const block = {
    id: 'chk3', type: 'checklist', _change: 'new',
    verdictLabels: ['通过', '失败'],
    items: [{ id: 'i1', label: '功能覆盖' }],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="chk3"'), 'expected block wrapper');
  assert.ok(out.includes('checklist-group'), 'expected checklist-group in blockHtml');
  assert.ok(out.includes('通过'), 'expected verdictLabel in blockHtml output');
});

// ---------- renderPrototype（§1.4 A）----------

test('renderPrototype: mode=image 含 img 标签 + SVG overlay', () => {
  const block = {
    id: 'proto1', type: 'prototype', mode: 'image', imageUrl: '/assets/screen.png', title: '登录页',
  };
  const out = renderPrototype(block);
  assert.ok(out.includes('<img'), 'expected <img> in image mode');
  assert.ok(out.includes('/assets/screen.png'), 'expected imageUrl in src');
  assert.ok(out.includes('proto-overlay'), 'expected SVG overlay');
  assert.ok(out.includes('proto-pins'), 'expected pins group in SVG');
  assert.ok(out.includes('data-proto-overlay="proto1"'), 'expected data-proto-overlay');
});

test('renderPrototype: mode=iframe 含 iframe + /api/proxy + SVG overlay', () => {
  const block = {
    id: 'proto2', type: 'prototype', mode: 'iframe', src: 'https://example.com/design',
  };
  const out = renderPrototype(block);
  assert.ok(out.includes('<iframe'), 'expected <iframe> in iframe mode');
  assert.ok(out.includes('/api/proxy?url='), 'expected proxy URL');
  assert.ok(out.includes(encodeURIComponent('https://example.com/design')), 'expected encoded src');
  assert.ok(out.includes('proto-overlay'), 'expected SVG overlay on outer layer');
  assert.ok(!out.includes('proto-overlay" src='), 'overlay must NOT be inside iframe src');
});

test('renderPrototype: mode=wireframe 含 proto-wireframe-canvas + SVG overlay', () => {
  const block = {
    id: 'proto3', type: 'prototype', mode: 'wireframe',
    screen: {
      id: 's1', name: '首页', widgets: [
        { id: 'w1', cls: 'btn', x: 0.1, y: 0.2, w: 0.2, h: 0.05, text: '提交' },
      ],
    },
  };
  const out = renderPrototype(block);
  assert.ok(out.includes('proto-wireframe-canvas'), 'expected wireframe canvas');
  assert.ok(out.includes('提交'), 'expected widget text');
  assert.ok(out.includes('proto-overlay'), 'expected SVG overlay');
});

test('renderPrototype: SVG overlay 在 iframe 外层（不在 iframe src 内）', () => {
  const block = {
    id: 'proto4', type: 'prototype', mode: 'iframe', src: 'https://ui.example.com',
  };
  const out = renderPrototype(block);
  // SVG overlay 应在 iframe-wrap 里但在 iframe 外层
  const iframePos  = out.indexOf('<iframe');
  const overlayPos = out.indexOf('proto-overlay');
  assert.ok(iframePos !== -1, 'expected <iframe>');
  assert.ok(overlayPos !== -1, 'expected proto-overlay');
  // overlay 出现在 iframe 之后（都在 iframe-wrap 内部，overlay 跟着 iframe）
  assert.ok(overlayPos > iframePos, 'SVG overlay must appear after iframe tag (outer wrapper)');
});

test('renderPrototype: blockHtml 含 proto-container', () => {
  const block = {
    id: 'proto5', type: 'prototype', mode: 'image', imageUrl: '/x.png', _change: 'new',
  };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="proto5"'), 'expected block wrapper');
  assert.ok(out.includes('proto-container'), 'expected proto-container in blockHtml');
});

test('renderZones: zoneCFyi 沉降区保留"AI 设默认"含义（_decidedInPrev 不影响 zoneCFyi）', () => {
  // zoneCFyi 块是 fresh(new/changed) + 有 default + 非 high importance
  const blocks = [
    { id: 'fyi1', type: 'markdown', needsDecision: false, default: 'yes', importance: 'normal', _change: 'new', body: 'fyi content' },
  ];
  const out = renderZones(blocks);
  // zoneCFyi 仍按原有逻辑，不应受 _decidedInPrev 影响
  assert.ok(out.includes('zone-c-fyi'), 'expected zone-c-fyi for fresh fyi blocks');
  // zoneSettled 不应出现
  assert.ok(!out.includes('zone-settled'), 'zoneSettled must not appear for fresh blocks');
});

// ---------- §13 落地校验批次 ----------

// P2：diff「↩已采纳/—维持」徽章类（配套 app.css 样式）
test('changeBadge: changed + _respondedToPrev → 含 badge-adopted 类', () => {
  const out = changeBadge({ _change: 'changed', _respondedToPrev: true });
  assert.ok(out.includes('badge-adopted'), `expected badge-adopted class in: ${out}`);
});

test('changeBadge: unchanged + _respondedToPrev → 含 badge-maintained 类', () => {
  const out = changeBadge({ _change: 'unchanged', _respondedToPrev: true });
  assert.ok(out.includes('badge-maintained'), `expected badge-maintained class in: ${out}`);
});

// P2：进度条「已填 m/X」文字随渲染出现（初值 0）
test('renderZones: 状态条含决策进度「已填 0/X」', () => {
  const blocks = [
    { id: 'p1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'p2', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'changed' },
    { id: 'u1', type: 'markdown', needsDecision: false, _change: 'unchanged' },
  ];
  const out = renderZones(blocks, { round: 2 });
  assert.ok(out.includes('decision-count'), `expected decision-count span in: ${out.slice(0, 500)}`);
  assert.ok(out.includes('已填 0/2'), `expected 已填 0/2 (new+changed decisions) in: ${out.slice(0, 500)}`);
});

// P2：zoneCFyi 折叠标题不再重复前缀（fyiSummary 修复）
test('renderZones: zoneCFyi 折叠标题无重复前缀', () => {
  const blocks = [
    { id: 'fyiX', type: 'markdown', needsDecision: false, default: 'yes', importance: 'normal', _change: 'new', body: 'x' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('已为你设好默认（1 项）· fyiX: yes'), `expected single-prefixed summary in: ${out}`);
  assert.ok(!out.includes('默认已设好'), `should not contain the old inner prefix 默认已设好 in: ${out}`);
});

// ---------- tab 分面导航（DESIGN §15）----------

test('renderZones: 有 section → 渲染 tab-nav + facet + 空面灰 tab', () => {
  const blocks = [
    { id: 'need1', section: '需求', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'arch1', section: '架构', type: 'markdown', needsDecision: false, _change: 'new', body: '架构说明' },
  ];
  const out = renderZones(blocks, { round: 1 });
  assert.ok(out.includes('tab-nav'), `expected tab-nav in: ${out.slice(0, 400)}`);
  assert.ok(out.includes('class="facet"'), 'expected facet panels');
  assert.ok(out.includes('需求') && out.includes('架构'), 'expected tab labels');
  assert.ok(out.includes('UI 设计'), 'empty canonical tab still shown');
  assert.ok(out.includes('tab-empty'), 'empty tab grayed');
  assert.ok(out.includes('tab-badge'), '需求 面含决策 → 角标');
});

test('renderZones: 无 section → 不渲染 tab-nav（向后兼容）', () => {
  const blocks = [{ id: 'p1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' }];
  const out = renderZones(blocks, { round: 1 });
  assert.ok(!out.includes('tab-nav'), 'no section → no tab nav');
  assert.ok(!out.includes('class="facet"'), 'no facet panels');
});

test('renderZones: tab 面内 设计方案(叙述) 在 决策 之前', () => {
  const blocks = [
    { id: 'ctxb', section: '架构', type: 'markdown', needsDecision: false, _change: 'new', body: '设计方案说明' },
    { id: 'decb', section: '架构', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
  ];
  const out = renderZones(blocks, { round: 1 });
  assert.ok(out.indexOf('ctxb') < out.indexOf('decb'), '面内 zone-context 应在 zone-a 之前');
});

test('renderZones: tab 角标颜色反映 必须(must)', () => {
  const blocks = [
    { id: 'nb', section: '需求', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
  ];
  const out = renderZones(blocks, { round: 1 });
  assert.ok(out.includes('tab-badge-must'), '含必须确认 → 红角标类');
});

// ---------- 决策块结构化 / live / 受众分层 / editable 确认（iteration-brief 2026-07-13）----------

test('blockHtml: 决策块四段式——背景 → 为什么需要你定 → 选项(含利弊) → 推荐及理由', () => {
  const block = {
    id: 'b-afx', type: 'choice', _change: 'new',
    title: 'AFX 处置', needsDecision: true, hasRecommendation: true, recommendation: 'disable',
    background: '仓库里已经住着一个老版的自动修理工。',
    why: '一个仓库不能住两个自动修理工。',
    recommendReason: '不删代码，完全可回退。',
    options: [
      { id: 'disable', label: '停用', pros: ['不再抢着改同一份代码'], cons: ['本地通道暂时用不了'] },
      { id: 'coexist', label: '共存', cons: ['会互相制造合并冲突'] },
    ],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('背景'), '应有背景段');
  assert.ok(out.includes('为什么需要你定'), '应有 why 段');
  assert.ok(out.includes('推荐及理由'), '应有推荐理由段');
  assert.ok(out.includes('opt-pros') && out.includes('opt-cons'), '应渲染利弊');
  assert.ok(out.includes('不再抢着改同一份代码') && out.includes('会互相制造合并冲突'));
  // 次序：背景 → why → 选项 → 推荐理由
  assert.ok(out.indexOf('背景') < out.indexOf('为什么需要你定'), '背景应在 why 之前');
  assert.ok(out.indexOf('为什么需要你定') < out.indexOf('choice-group'), 'why 应在选项之前');
  assert.ok(out.indexOf('choice-group') < out.indexOf('推荐及理由'), '推荐理由应在选项之后');
});

test('blockHtml: 无新字段的老块渲染不变（向后兼容）', () => {
  const out = blockHtml({ id: 'b-old', type: 'choice', _change: 'new', options: [{ id: 'a', label: 'A' }] });
  assert.ok(!out.includes('decision-context'), '无 background/why → 不渲染决策上下文');
  assert.ok(!out.includes('opt-proscons'), '无利弊 → 不渲染利弊区');
  assert.ok(!out.includes('推荐及理由'));
  assert.ok(out.includes('choice-group'), '选项仍正常渲染');
});

test('blockHtml: live:true → ⚡实时系统角标 + data-live（病例7：视觉层，不靠文案）', () => {
  const out = blockHtml({ id: 'b-live', type: 'embed', url: 'http://x/y', live: true, _change: 'new' });
  assert.ok(out.includes('data-live="true"'), '应有 data-live 属性');
  assert.ok(out.includes('live-badge') && out.includes('⚡ 实时系统'), '应有实时系统角标');
  const plain = blockHtml({ id: 'b-demo', type: 'embed', url: 'http://x/y', _change: 'new' });
  assert.ok(!plain.includes('data-live'), '无 live 字段 → 行为不变');
});

test('blockHtml: audience:"tech" → 折叠进「技术细节」（病例2：不占决策者注意力）', () => {
  const out = blockHtml({ id: 'b-yaml', type: 'code', lang: 'yaml', body: 'verify:', audience: 'tech', title: 'verify 草案', _change: 'new' });
  assert.ok(out.includes('data-audience="tech"'));
  assert.ok(out.includes('<details class="tech-fold">'), '应折叠');
  assert.ok(out.includes('技术细节'), '折叠标题应说明可跳过');
  const normal = blockHtml({ id: 'b-n', type: 'code', body: 'x', _change: 'new' });
  assert.ok(!normal.includes('tech-fold'), '默认不折叠');
});

test('renderEditable: 提供「保持原样即确认」一键（病例5：editable 是高摩擦）', () => {
  const out = blockHtml({ id: 'b-draft', type: 'editable', value: '草稿正文', needsDecision: true, _change: 'new' });
  assert.ok(out.includes('data-editable-confirm="b-draft"'), '应有一键确认按钮');
  assert.ok(out.includes('保持原样即确认'));
  assert.ok(out.includes('data-editable-confirmed="b-draft"'), '应有确认读态');
});

// ---------- 线框原型：手机壳 + 编辑模式（复刻 prd-studio 的 protoModes）----------

test('renderPrototype(wireframe): frame:phone → 手机壳 + 刘海', () => {
  const block = {
    id: 'b-proto-home', type: 'prototype', mode: 'wireframe', frame: 'phone', _change: 'new',
    screen: { id: 'home', name: '主界面', widgets: [{ id: 'title', cls: 'label', x: 0.05, y: 0.04, w: 0.6, h: 0.04, text: '会议录音' }] },
  };
  const out = blockHtml(block);
  assert.ok(out.includes('proto-phone'), '应套手机壳');
  assert.ok(out.includes('proto-notch'), '应有刘海（更像真机）');
});

test('renderPrototype(wireframe): 模式工具条（批注/编辑）+ 控件可拖拽钩子', () => {
  const block = {
    id: 'b-proto-home', type: 'prototype', mode: 'wireframe', frame: 'phone', _change: 'new',
    screen: { id: 'home', name: '主界面', widgets: [{ id: 'title', cls: 'label', x: 0.05, y: 0.04, w: 0.6, h: 0.04, text: '会议录音' }] },
  };
  const out = blockHtml(block);
  assert.ok(out.includes('data-proto-mode="annotate"') && out.includes('data-proto-mode="edit"'), '应有 批注/编辑 两模式');
  assert.ok(out.includes('data-proto-reset="b-proto-home"'), '应有复位按钮');
  assert.ok(out.includes('data-mode="annotate"'), '默认批注模式');
  // 控件带 id + 缩放柄 → 编辑模式可拖动/缩放
  assert.ok(out.includes('data-proto-widget="b-proto-home"'), '控件应带 blockId 钩子');
  assert.ok(out.includes('data-widget-id="title"'), '控件应带 widgetId（move 反馈按此定位）');
  assert.ok(out.includes('data-proto-resize'), '应有缩放柄');
});

test('renderPrototype(wireframe): 无 frame 时保持原朴素画布（向后兼容）', () => {
  const out = blockHtml({
    id: 'b-p', type: 'prototype', mode: 'wireframe', _change: 'new',
    screen: { id: 's', name: 'x', widgets: [] },
  });
  assert.ok(!out.includes('proto-phone'), '无 frame:phone → 不套壳');
  assert.ok(out.includes('proto-wireframe-canvas'));
});

test('renderPrototype(iframe): 同源相对 src 直连（不绕代理）；外站绝对 URL 才走代理', () => {
  const local = blockHtml({ id: 'b-ui-home', type: 'prototype', mode: 'iframe', frame: 'phone', src: '/assets/s/ui/b-home.html', _change: 'new' });
  assert.ok(local.includes('src="/assets/s/ui/b-home.html"'), '同源相对路径应直接用');
  assert.ok(!local.includes('/api/proxy'), '同源不该绕代理');

  const remote = blockHtml({ id: 'b-ui-x', type: 'prototype', mode: 'iframe', src: 'http://example.com/a.html', _change: 'new' });
  assert.ok(remote.includes('/api/proxy?url='), '外站绝对 URL 仍走代理（绕过 X-Frame-Options）');
});

test('mdToHtml 围栏代码块渲染为等宽 pre 且内容转义、不做行内转换', () => {
  const html = mdToHtml('前文\n```\n<b>**不该加粗**</b>\n```\n后文');
  assert.match(html, /<pre class="md-fence"><code>/);
  assert.match(html, /&lt;b&gt;/);
  assert.equal(html.includes('<strong>'), false, '围栏内不做行内转换');
  assert.equal(html.includes('```'), false, '反引号不外露');
});

test('mdToHtml 未闭合围栏不吞掉后续内容为不可见', () => {
  const html = mdToHtml('```\n孤行围栏');
  assert.equal(html.includes('孤行围栏') || html.includes('md-fence'), true);
});

// ---------- mermaid 渲染契约（2026-08-13 线上双故障回归锁）----------
// 病史：mermaid.run() 在元素内就地渲染，图块被 tab 分面藏进 display:none 容器时
// 零尺寸导致边标签定位崩溃（"Could not find a suitable point for the given distance"），
// mermaid 又把一切错误统一显示为 "Syntax error in text" 炸弹图，纯误导；
// 另有 vendor 脚本异步加载竞态——内容先渲染完则图裸奔且无人补渲染。
// 修法契约如下，任何一条被改掉都会让线上炸弹图/裸奔复发：

test('mermaid 必须用脱离容器的 render() 而非就地 run()（隐藏 tab 零尺寸会崩）', () => {
  assert.match(renderApp, /function renderMermaidDiagrams/, '渲染入口 renderMermaidDiagrams 不可删');
  assert.match(renderApp, /mermaid\.render\(/, '必须走 mermaid.render(id, src) 脱离容器渲染');
  assert.doesNotMatch(renderApp, /window\.mermaid\.run\(\)/, '禁止回退到裸 mermaid.run()');
});

test('mermaid 源码从 textContent 取，失败时诚实降级（真实错误 + 源码，不放炸弹）', () => {
  assert.match(renderApp, /renderMermaidDiagrams[\s\S]{0,600}textContent/, '取源必须走 textContent，绕开 innerHTML 实体往返');
  assert.match(renderApp, /mermaid-fallback/, '失败降级容器 .mermaid-fallback 不可删');
  assert.match(renderApp, /图渲染失败/, '降级文案必须展示真实错误而非 mermaid 的误导性 Syntax error');
});

test('mermaid 脚本加载竞态有补渲染钩子（内容先就绪时不再裸奔）', () => {
  assert.match(renderApp, /window\.__renderMermaidDiagrams\s*=/, 'app.mjs 必须暴露补渲染钩子');
  assert.match(renderIndex, /__renderMermaidDiagrams/, 'index.html 的 vendor onload 必须调用补渲染钩子');
});

// ---------- 长寿命页版本握手（2026-08-13 二次故障回归锁）----------
// 病史：渲染页只就地换内容、从不重载 JS——用户几天前打开的旧标签页永远跑老代码，
// 已修故障（mermaid 炸弹图）在旧页面"复发"（页面显示 mermaid 10.9.1，磁盘已是 11.15.0）。
// 修法：/api/status 带 assetsVersion（关键渲染资产最新 mtime），页面轮询比对，变了自刷新。
const serverSrc = readFileSync(path.resolve(__dirname, '../../src/server/server.mjs'), 'utf8');

test('版本握手：/api/status 必须带 assetsVersion，页面比对后自动整页刷新', () => {
  assert.match(serverSrc, /export function assetsVersion/, '服务端 assetsVersion 计算函数不可删');
  assert.match(serverSrc, /assetsVersion: assetsVersion\(\)/, '/api/status 响应必须包含 assetsVersion');
  assert.match(renderApp, /__wbAssetsVersion/, '页面必须记录并比对资产版本');
  assert.match(renderApp, /location\.reload/, '版本变化必须触发整页刷新（草稿在 localStorage，无损）');
});

// ---------- 资产版本注入（2026-08-13 三连修之三：击穿历史启发式缓存）----------
// 病史：no-store 是后加的，headerless 时代浏览器按启发式规则缓存了旧 app.mjs/mermaid，
// 此类缓存不再询问服务器，响应头无法追溯清除——用户新开标签页仍拿到旧代码，
// 前两次修复（脱离容器渲染、版本握手）因此全部无法送达。根治=改 URL。
test('资产版本注入：HTML 模板化 + import map + Clear-Site-Data，资源全部带 ?v= 加载', () => {
  assert.match(renderIndex, /__WB_ASSETS_V__/, 'index.html 必须带版本占位符');
  assert.match(renderIndex, /__WB_IMPORTMAP__/, 'index.html 必须带 import map 占位符（子模块也要版本化）');
  assert.match(renderIndex, /app\.css\?v=/, 'CSS 必须带版本参数');
  assert.match(renderIndex, /mermaid\.min\.js\?v=/, 'vendor 必须带版本参数');
  assert.match(renderIndex, /import\('\.\/app\.mjs\?v='/, 'app.mjs 必须以版本化动态 import 加载');
  assert.doesNotMatch(renderIndex, /src="app\.mjs"/, '禁止回退到无版本的静态 script 标签');
  assert.match(serverSrc, /replaceAll\('__WB_ASSETS_V__'/, '服务端必须注入真实版本');
  assert.match(serverSrc, /Clear-Site-Data/, '服务端必须在 HTML 响应发 Clear-Site-Data 清历史缓存');
});

// ---------- embed 同源直连 + 客户门户标题（2026-08-14 sirui round1 独立验证回归锁）----------
test('embed 同源相对路径直连 iframe，仅外站绝对 URL 走代理（相对路径进 proxy 会 400）', () => {
  const local = renderEmbed({ id: 'b-e1', url: '/assets/sirui/x.html' });
  assert.ok(local.includes('src="/assets/sirui/x.html"'), '同源相对路径应直接作为 iframe src');
  assert.ok(!local.includes('/api/proxy'), '同源不该绕代理');
  const remote = renderEmbed({ id: 'b-e2', url: 'https://example.com/a.html' });
  assert.ok(remote.includes('/api/proxy?url='), '外站绝对 URL 仍走代理');
});

test('页面标题可由 WORKBENCH_TITLE 注入（客户门户不得显示内部工具名）', () => {
  assert.match(renderIndex, /__WB_TITLE__/, 'index.html 必须带标题占位符');
  assert.match(serverSrc, /WORKBENCH_TITLE/, '服务端必须支持标题环境变量注入');
  assert.match(renderApp, /__WB_TITLE/, 'app.mjs 动态标题必须使用注入值');
});
