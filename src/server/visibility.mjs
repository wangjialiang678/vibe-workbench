import path from 'node:path';
import { disk } from '../storage/index.mjs';
import { validateContent } from '../protocol/schema.mjs';
import { paths, readJSON } from '../workspace.mjs';
import { readStreamEntries } from '../stream.mjs';
import { validRoundQuery } from './route-utils.mjs';
import { OWNER_IDENTITY } from './auth.mjs';

export const TERMINAL_OR_PROCESSING_STATES = new Set(['claimed', 'responded', 'error']);
export function isBlockVisibleTo(block, identity) { return identity?.role !== 'participant' || block?.assignee == null || block.assignee === '' || block.assignee === identity.id; }
export function visibleBlocksForIdentity(blocks, identity) { return Array.isArray(blocks) ? blocks.filter((block) => isBlockVisibleTo(block, identity)) : []; }
function readValidContentForVisibility(session, round) {
  const content = readJSON(paths.content(session, round, { exactSession: true }), null);
  return validateContent(content).ok && content.session === session && content.round === round ? content : null;
}
export function feedbackVisibilityForIdentity(session, round, identity) {
  if (identity?.role !== 'participant') return { role: 'owner' };
  const content = readValidContentForVisibility(session, round);
  if (!Array.isArray(content?.blocks)) return { role: 'participant', valid: false };
  return { role: 'participant', valid: true, knownBlockIds: new Set(content.blocks.map((block) => block?.id).filter((id) => typeof id === 'string')), visibleBlockIds: new Set(visibleBlocksForIdentity(content.blocks, identity).map((block) => block?.id).filter((id) => typeof id === 'string')) };
}
export function filterFeedbackForIdentity(feedback, visibility) {
  if (!feedback || visibility?.role !== 'participant') return feedback;
  if (!visibility.valid || !Array.isArray(feedback.items) || (feedback.unanswered != null && !Array.isArray(feedback.unanswered))) return null;
  return { ...feedback, items: feedback.items.filter((item) => visibility.visibleBlockIds.has(item?.blockId)), ...(Array.isArray(feedback.unanswered) ? { unanswered: feedback.unanswered.filter((id) => visibility.visibleBlockIds.has(id)) } : {}) };
}
function streamBlockRefVisible(session, refs, identity) {
  if (identity?.role !== 'participant') return true;
  if (!refs || typeof refs.blockId !== 'string') return true;
  const round = validRoundQuery(refs.round); const content = round == null ? null : readValidContentForVisibility(session, round);
  const block = Array.isArray(content?.blocks) ? content.blocks.find((candidate) => candidate?.id === refs.blockId) : null;
  return Boolean(block && isBlockVisibleTo(block, identity));
}
export function filterStreamEntriesForIdentity(session, entries, allEntries, identity) {
  if (identity?.role !== 'participant') return entries;
  const hiddenAskIds = new Set(allEntries.filter((entry) => entry.kind === 'ask' && entry.refs?.blockId && !streamBlockRefVisible(session, entry.refs, identity)).map((entry) => entry.ask?.id).filter(Boolean));
  return entries.flatMap((entry) => {
    if ((entry.kind === 'ask' && hiddenAskIds.has(entry.ask?.id)) || (entry.kind === 'answer' && hiddenAskIds.has(entry.answerTo))) return [];
    if (!entry.refs?.blockId || streamBlockRefVisible(session, entry.refs, identity)) return [entry];
    if (['message', 'progress', 'receipt'].includes(entry.kind)) return [];
    const refs = { ...entry.refs }; delete refs.blockId; return Object.keys(refs).length ? [{ ...entry, refs }] : [Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'refs'))];
  });
}
export function assertParticipantCanAnswerAsk(session, answerTo, identity) {
  if (identity?.role !== 'participant' || typeof answerTo !== 'string') return;
  const ask = readStreamEntries(session, { limit: Number.MAX_SAFE_INTEGER, exactSession: true }).find((entry) => entry.kind === 'ask' && entry.ask?.id === answerTo);
  if (ask?.refs?.blockId && !streamBlockRefVisible(session, ask.refs, identity)) { const error = new Error('该 ask 关联的 block 对当前参与者不可见'); error.code = 'ASK_NOT_VISIBLE'; throw error; }
}
function participantFeedbackEntries(session, round) {
  const dir = path.dirname(paths.feedback(session, round, { exactSession: true })); let filenames;
  try { filenames = disk.readdirSync(dir).filter((name) => /^feedback-[A-Za-z0-9_-]+\.json$/.test(name)).sort(); } catch { return []; }
  return filenames.flatMap((filename) => { const feedback = readJSON(path.join(dir, filename), null); const id = feedback?.submittedBy?.id; const name = feedback?.submittedBy?.name; return feedback && typeof id === 'string' && typeof name === 'string' ? [{ id, name, submittedAt: feedback.submittedAt ?? null, feedback }] : []; });
}
function detectFeedbackConflicts(ownerFeedback, byParticipant) {
  const byBlock = new Map();
  for (const source of [ownerFeedback && { name: ownerFeedback.submittedBy?.name || '管理员', feedback: ownerFeedback }, ...byParticipant.map((entry) => ({ name: entry.name, feedback: entry.feedback }))].filter(Boolean)) {
    for (const item of source.feedback?.items || []) if (item?.type === 'select' && typeof item.blockId === 'string') { const choices = byBlock.get(item.blockId) || []; choices.push({ participant: source.name, value: item.value }); byBlock.set(item.blockId, choices); }
  }
  return [...byBlock].flatMap(([blockId, choices]) => new Set(choices.map(({ value }) => JSON.stringify(value))).size > 1 ? [{ blockId, choices }] : []);
}
export function feedbackView(session, round, identity = OWNER_IDENTITY) {
  const visibility = feedbackVisibilityForIdentity(session, round, identity); const primary = filterFeedbackForIdentity(readJSON(paths.feedback(session, round, { exactSession: true }), null), visibility); const byParticipant = participantFeedbackEntries(session, round).map((entry) => ({ ...entry, feedback: filterFeedbackForIdentity(entry.feedback, visibility) })); const ownerFeedback = primary && (!primary.submittedBy || primary.submittedBy.id === 'owner') ? primary : null; const primaryParticipant = primary?.submittedBy?.id ? byParticipant.find((entry) => entry.id === primary.submittedBy.id)?.feedback : null;
  return { feedback: ownerFeedback || primaryParticipant || byParticipant[0]?.feedback || primary, byParticipant, conflicts: detectFeedbackConflicts(ownerFeedback, byParticipant) };
}
