// 决策人展示层解析：真实参与者名册为空时，用 owner/Michael 兜底。
// 该条目不带 token，也不写入 participants.json，不参与 magic-link 鉴权。
export const DEFAULT_DECISION_MAKER = Object.freeze({
  id: 'owner',
  name: 'Michael',
  role: 'owner',
});

export function resolveDecisionMakers(participants = []) {
  return Array.isArray(participants) && participants.length > 0
    ? participants
    : [{ ...DEFAULT_DECISION_MAKER }];
}

export function decisionMakerSelectionValue(decisionMaker) {
  const prefix = decisionMaker?.role === 'owner' ? 'owner' : 'participant';
  return `${prefix}:${decisionMaker?.id ?? ''}`;
}
