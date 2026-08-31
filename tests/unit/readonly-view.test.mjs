import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as readonlyView from '../../src/render/readonly-view.mjs';

const {
  historyFeedbackEntries,
  historySessionCommentsHtml,
  isRoundReadonly,
  readonlyBannerText,
  readonlyBlockFeedbackHtml,
  submittedDraftNoticeHtml,
} = readonlyView;

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

test('历史轮只读锁同步覆盖 status 晚到、先到、轮询切换与乱序响应', () => {
  assert.equal(
    typeof readonlyView.createReadonlyRoundSync,
    'function',
    '前端需要一个由渲染完成与 status 到达共同驱动的只读锁同步器',
  );

  const applied = [];
  const attributes = new Set();
  const controls = [{ disabled: false }];
  const frames = [{ tabindex: null, setAttribute(name, value) { this[name] = value; } }];
  const zones = {
    toggleAttribute(name, enabled) {
      if (enabled) attributes.add(name);
      else attributes.delete(name);
    },
    querySelectorAll(selector) {
      return selector === 'iframe' ? frames : controls;
    },
  };
  const banner = { hidden: true, textContent: '' };
  const sessionCommentSection = { hidden: false };
  const submitButton = { hidden: false };
  const sync = readonlyView.createReadonlyRoundSync({
    currentRound: 1,
    latestRound: 1,
    apply(state) {
      applied.push({ ...state });
      readonlyView.applyReadonlyDomState({
        ...state,
        zones,
        banner,
        sessionCommentSection,
        updateSubmitVisibility(readonly) {
          submitButton.hidden = readonly;
        },
      });
    },
  });

  // 首屏先渲染、status 后到：status 到达时必须补锁。
  sync.rendered();
  assert.equal(applied.at(-1).readonly, false);
  sync.statusArrived(2);
  assert.deepEqual(applied.at(-1), { readonly: true, currentRound: 1, latestRound: 2 });
  assert.equal(attributes.has('data-readonly'), true);
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, '历史轮（第 1 轮）只读回看——如需变更请在最新轮提出');
  assert.equal(sessionCommentSection.hidden, true);
  assert.equal(submitButton.hidden, true);
  assert.equal(controls[0].disabled, true);
  assert.equal(frames[0].tabindex, '-1');

  // 已知较新轮次后，即使旧请求晚到，也不能把最新轮倒退后解锁。
  const appliedCount = applied.length;
  assert.deepEqual(sync.statusArrived(1), { readonly: true, currentRound: 1, latestRound: 2 });
  assert.equal(applied.length, appliedCount);

  // FOLLOW_LATEST 推进到最新轮后应解锁；同一轮重新渲染必须向新 DOM 补应用。
  sync.roundChanged(2);
  assert.deepEqual(applied.at(-1), { readonly: false, currentRound: 2, latestRound: 2 });
  assert.equal(attributes.has('data-readonly'), false);
  assert.equal(banner.hidden, true);
  assert.equal(submitButton.hidden, false);
  sync.rendered();
  assert.deepEqual(applied.at(-1), { readonly: false, currentRound: 2, latestRound: 2 });

  // 轮询发现新一轮时重新加锁。
  sync.statusArrived(3);
  assert.deepEqual(applied.at(-1), { readonly: true, currentRound: 2, latestRound: 3 });

  // status 先于首屏渲染到达：渲染完成时必须按已知轮次应用锁。
  const statusFirstApplied = [];
  const statusFirst = readonlyView.createReadonlyRoundSync({
    currentRound: 1,
    latestRound: 1,
    apply(state) {
      statusFirstApplied.push({ ...state });
    },
  });
  statusFirst.statusArrived(2);
  assert.deepEqual(statusFirstApplied, []);
  statusFirst.rendered();
  assert.deepEqual(statusFirstApplied, [{ readonly: true, currentRound: 1, latestRound: 2 }]);
});
