// 草稿存取的纯逻辑。storage 由调用方注入，浏览器入口负责传入 localStorage。

export function draftKey(session, round) {
  return `wb:${session}:${round}:fb`;
}

export function mergeDraft(previous, patch) {
  return Object.assign(previous, patch);
}

export function readDraft(storage, key) {
  try { return JSON.parse(storage.getItem(key) ?? 'null') ?? {}; }
  catch { return {}; }
}

export function writeDraft(storage, key, draft) {
  storage.setItem(key, JSON.stringify(draft));
  return draft;
}
