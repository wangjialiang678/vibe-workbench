// 草稿存取的纯逻辑。storage 由调用方注入，浏览器入口负责传入 localStorage。

const SUBMITTED_KEY = '__submittedAt';

export function draftKey(session, round) {
  return `wb:${session}:${round}:fb`;
}

export function mergeDraft(previous, patch) {
  delete previous[SUBMITTED_KEY];
  return Object.assign(previous, patch);
}

export function markSubmitted(draft, submittedAt) {
  const at = typeof submittedAt === 'string' && submittedAt ? submittedAt : new Date().toISOString();
  return { ...draft, [SUBMITTED_KEY]: at };
}

export function isSubmitted(draft) {
  return Boolean(draft && typeof draft[SUBMITTED_KEY] === 'string' && draft[SUBMITTED_KEY]);
}

export function submittedAt(draft) {
  return isSubmitted(draft) ? draft[SUBMITTED_KEY] : null;
}

export function readDraft(storage, key) {
  try { return JSON.parse(storage.getItem(key) ?? 'null') ?? {}; }
  catch { return {}; }
}

export function writeDraft(storage, key, draft) {
  storage.setItem(key, JSON.stringify(draft));
  return draft;
}
