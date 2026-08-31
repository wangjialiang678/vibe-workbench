import { participantFeedbackHtml } from './blocks.mjs';

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isRoundReadonly(currentRound, latestRound) {
  const current = Number(currentRound);
  const latest = Number(latestRound);
  return Number.isInteger(current) && Number.isInteger(latest) && current > 0 && latest > current;
}

function positiveRound(value) {
  const round = Number(value);
  return Number.isInteger(round) && round > 0 ? round : null;
}

// 首屏渲染和 /api/status 是两条异步链：任一条后到，都要把同一份只读状态补到 DOM。
// latestRound 只允许前进，避免启动期并发请求乱序时旧响应把历史轮错误解锁。
export function createReadonlyRoundSync({ currentRound, latestRound, apply }) {
  if (typeof apply !== 'function') throw new TypeError('apply must be a function');

  let current = positiveRound(currentRound);
  let latest = positiveRound(latestRound);
  let hasRendered = false;
  let lastAppliedReadonly = null;

  function state() {
    return {
      readonly: isRoundReadonly(current, latest),
      currentRound: current,
      latestRound: latest,
    };
  }

  function sync({ force = false } = {}) {
    const next = state();
    if (hasRendered && (force || next.readonly !== lastAppliedReadonly)) {
      apply(next);
      lastAppliedReadonly = next.readonly;
    }
    return next;
  }

  return {
    statusArrived(round) {
      const candidate = positiveRound(round);
      if (candidate != null && (latest == null || candidate > latest)) latest = candidate;
      return sync();
    },
    roundChanged(round) {
      current = positiveRound(round);
      return sync();
    },
    rendered() {
      hasRendered = true;
      return sync({ force: true });
    },
    refresh() {
      return sync({ force: true });
    },
  };
}

export function applyReadonlyDomState({
  readonly,
  currentRound,
  zones,
  banner,
  sessionCommentSection,
  updateSubmitVisibility,
}) {
  zones?.toggleAttribute('data-readonly', readonly);
  if (banner) {
    banner.hidden = !readonly;
    banner.textContent = readonly ? readonlyBannerText(currentRound) : '';
  }
  if (sessionCommentSection) sessionCommentSection.hidden = readonly;
  if (readonly) {
    zones?.querySelectorAll('input, textarea, select, button:not(.tab)').forEach((control) => {
      control.disabled = true;
    });
    zones?.querySelectorAll('iframe').forEach((frame) => frame.setAttribute('tabindex', '-1'));
  }
  updateSubmitVisibility?.(readonly);
  return readonly;
}

export function readonlyBannerText(round) {
  return `历史轮（第 ${Number(round)} 轮）只读回看——如需变更请在最新轮提出`;
}

export function historyFeedbackEntries(submissions = []) {
  return (Array.isArray(submissions) ? submissions : []).map((feedback, index) => {
    const submittedBy = feedback?.submittedBy ?? null;
    const selfReportedBy = feedback?.selfReportedBy ?? null;
    return {
      id: submittedBy?.id || `submission-${index + 1}`,
      name: selfReportedBy?.name || selfReportedBy?.id || submittedBy?.name || submittedBy?.id || '匿名',
      submittedAt: feedback?.submittedAt ?? null,
      submittedBy,
      selfReportedBy,
      feedback,
    };
  });
}

export function readonlyBlockFeedbackHtml(block, submissions = []) {
  return participantFeedbackHtml(block, historyFeedbackEntries(submissions), [], { showSubmissionMeta: true });
}

export function historySessionCommentsHtml(submissions = []) {
  const comments = historyFeedbackEntries(submissions).flatMap((entry) => {
    const comment = entry.feedback?.sessionComment;
    if (typeof comment !== 'string' || !comment.trim()) return [];
    const meta = [
      entry.submittedBy?.name || entry.submittedBy?.id ? `提交人：${entry.submittedBy?.name || entry.submittedBy?.id}` : '',
      entry.selfReportedBy?.name || entry.selfReportedBy?.id ? `自报人：${entry.selfReportedBy?.name || entry.selfReportedBy?.id}` : '',
      entry.submittedAt ? `提交时间：${entry.submittedAt}` : '',
    ].filter(Boolean).join('｜');
    return [`<article class="history-session-comment"><div class="participant-opinion-meta">${escHtml(meta)}</div><p>${escHtml(comment)}</p></article>`];
  });
  return comments.length
    ? `<section class="history-session-comments" aria-label="该轮已提交的会话留言"><h3>已提交的会话留言</h3>${comments.join('')}</section>`
    : '';
}

export function submittedDraftNoticeHtml(at) {
  return `<div class="submitted-draft-notice" role="status">已于 ${escHtml(at || '此前')} 提交</div>`;
}
