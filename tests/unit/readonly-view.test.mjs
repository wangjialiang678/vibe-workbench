import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyFeedbackEntries,
  historySessionCommentsHtml,
  isRoundReadonly,
  readonlyBannerText,
  readonlyBlockFeedbackHtml,
  submittedDraftNoticeHtml,
} from '../../src/render/readonly-view.mjs';

test('历史轮判定与提示文案只在当前轮小于最新轮时成立', () => {
  assert.equal(isRoundReadonly(1, 2), true);
  assert.equal(isRoundReadonly(2, 2), false);
  assert.equal(isRoundReadonly(3, 2), false);
  assert.equal(isRoundReadonly(null, 2), false);
  assert.equal(readonlyBannerText(3), '历史轮（第 3 轮）只读回看——如需变更请在最新轮提出');
});

test('历史提交渲染为无编辑控件的只读意见，并标注可信身份、自报身份与时间', () => {
  const submissions = [{
    submittedAt: '2026-08-31T08:00:00.000Z',
    submittedBy: { id: 'owner', name: '管理员' },
    selfReportedBy: { id: 'alice', name: '小艾 <QA>' },
    items: [{ blockId: 'decision', type: 'select', value: 'safe', comment: '同意 & 补充' }],
    sessionComment: '整体意见 <只读>',
  }];
  const entries = historyFeedbackEntries(submissions);
  assert.equal(entries[0].name, '小艾 <QA>');

  const blockHtml = readonlyBlockFeedbackHtml({
    id: 'decision',
    type: 'choice',
    options: [{ id: 'safe', label: '稳妥方案' }],
  }, submissions);
  assert.match(blockHtml, /稳妥方案/);
  assert.match(blockHtml, /提交人：管理员/);
  assert.match(blockHtml, /自报人：小艾 &lt;QA&gt;/);
  assert.match(blockHtml, /提交时间：<time/);
  assert.doesNotMatch(blockHtml, /<(input|textarea|button|select)\b/);

  const commentsHtml = historySessionCommentsHtml(submissions);
  assert.match(commentsHtml, /整体意见 &lt;只读&gt;/);
  assert.doesNotMatch(commentsHtml, /<只读>/);
  assert.equal(submittedDraftNoticeHtml('2026-08-31T08:00:00.000Z'), '<div class="submitted-draft-notice" role="status">已于 2026-08-31T08:00:00.000Z 提交</div>');
});
