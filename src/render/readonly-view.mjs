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
