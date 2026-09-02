// 同构决策批量选择。纯逻辑，不依赖 DOM/localStorage，供浏览器交互与测试共用。

const MIN_BATCH_SIZE = 3;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function choiceSignature(block) {
  if (block?.type !== 'choice' || !Array.isArray(block.options) || block.options.length === 0) return '';
  return canonical({ multi: block.multi === true, options: block.options });
}

function choiceGroups(blocks, minimum) {
  const candidates = new Map();
  for (const block of blocks) {
    const signature = choiceSignature(block);
    if (!signature) continue;
    if (!candidates.has(signature)) candidates.set(signature, []);
    candidates.get(signature).push(block);
  }

  return [...candidates.values()]
    .filter((group) => group.length >= minimum)
    .map((group) => ({
      id: `choice:${group[0].id}`,
      kind: 'choice',
      anchorBlockId: group[0].id,
      options: group[0].options.map((option) => ({
        value: String(option.id),
        label: String(option.label ?? option.id),
      })),
      targets: group.map((block) => ({ blockId: block.id })),
    }));
}

function checklistGroups(blocks, minimum) {
  return blocks
    .filter((block) => block?.type === 'checklist' && Array.isArray(block.items) && block.items.length >= minimum)
    .map((block) => ({
      id: `checklist:${block.id}`,
      kind: 'checklist',
      anchorBlockId: block.id,
      options: (block.verdictLabels ?? ['赞成', '异议', '疑问']).map((label) => ({
        value: String(label),
        label: String(label),
      })),
      targets: block.items.map((item) => ({ blockId: block.id, itemId: item.id })),
    }));
}

export function batchSelectionGroups(blocks = [], { minimum = MIN_BATCH_SIZE } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  return [...choiceGroups(list, minimum), ...checklistGroups(list, minimum)];
}

function hasChoiceAnswer(draftItem) {
  return Array.isArray(draftItem?.select)
    ? draftItem.select.length > 0
    : draftItem?.select != null && draftItem.select !== '';
}

export function unansweredBatchTargets(group, draft = {}) {
  if (!group || !Array.isArray(group.targets)) return [];
  if (group.kind === 'choice') {
    return group.targets.filter(({ blockId }) => !hasChoiceAnswer(draft[blockId]));
  }
  if (group.kind === 'checklist') {
    return group.targets.filter(({ blockId, itemId }) => {
      const value = draft[blockId]?.checklistItems?.[itemId];
      return value == null || value === '';
    });
  }
  return [];
}

export function batchSelectionPatch(group, optionValue, draft = {}) {
  if (!group?.options?.some((option) => option.value === optionValue)) return {};
  const targets = unansweredBatchTargets(group, draft);
  if (group.kind === 'choice') {
    return Object.fromEntries(targets.map(({ blockId }) => [
      blockId,
      { ...(draft[blockId] || {}), select: optionValue },
    ]));
  }
  if (group.kind === 'checklist' && targets.length > 0) {
    const blockId = targets[0].blockId;
    const item = draft[blockId] || {};
    const checklistItems = { ...(item.checklistItems || {}) };
    for (const target of targets) checklistItems[target.itemId] = optionValue;
    return { [blockId]: { ...item, checklistItems } };
  }
  return {};
}

// 浏览器批量按钮把 dataset 交给这里；无效/过期动作安全退化为空 patch。
export function batchSelectionPatchFromAction(groups, action, draft = {}) {
  const group = (groups || []).find((candidate) => candidate.id === action?.batchGroup);
  return batchSelectionPatch(group, action?.batchValue, draft);
}
