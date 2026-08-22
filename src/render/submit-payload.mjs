// 反馈提交载荷的纯组装逻辑。

export function feedbackItems(draft = {}) {
  return Object.entries(draft).map(([blockId, item]) => {
    const entries = [];
    if (item.verdict) entries.push({ blockId, type: 'verdict', value: item.verdict, comment: item.comment });
    else if (item.select) entries.push({ blockId, type: 'select', value: item.select, comment: item.comment });
    else if (item.text) entries.push({ blockId, type: 'text', value: item.text, comment: item.comment });
    // 看了但不改（P2 · 病例 5）：与"没看"(unanswered) 语义区分
    else if (item.confirmed === true) entries.push({ blockId, type: 'confirm', value: '保持原样', comment: item.comment });
    if (item.comment && !item.verdict && !item.select && !item.text && item.confirmed !== true) {
      entries.push({ blockId, type: 'comment', value: null, comment: item.comment });
    }
    // embed 飞书式评论 → 每条有文本的评论产生一条 feedback item
    if (Array.isArray(item.comments)) {
      item.comments.forEach((comment) => {
        if (comment && comment.text) {
          entries.push({ blockId, type: 'pin', value: { quote: comment.quote }, comment: comment.text });
        }
      });
    }
    // checklist 三态 → 每个 item 产生一条 select feedback，value = 'itemId:label'
    if (item.checklistItems && typeof item.checklistItems === 'object') {
      Object.entries(item.checklistItems).forEach(([itemId, label]) => {
        if (label) entries.push({ blockId, type: 'select', value: `${itemId}:${label}` });
      });
    }
    // 原型控件移动（编辑模式）→ 每个被拖过的控件产生一条 move feedback（含归一化几何）
    if (item.moves && typeof item.moves === 'object') {
      Object.entries(item.moves).forEach(([widgetId, geometry]) => {
        entries.push({ blockId, type: 'move', value: { widgetId, ...geometry } });
      });
    }
    // prototype pin 批注 → 每条有文本的 pin 产生一条 pin feedback
    if (Array.isArray(item.pins)) {
      item.pins.forEach((pin) => {
        if (pin && pin.text) {
          entries.push({ blockId, type: 'pin', value: { xPct: pin.xPct, yPct: pin.yPct }, comment: pin.text });
        }
      });
    }
    return entries;
  }).flat();
}

export function submitPayload({ session, round, submittedAt, draft, unanswered, sessionComment, selfReport }) {
  return {
    session,
    round: Number(round),
    submittedAt,
    items: feedbackItems(draft),
    unanswered,
    sessionComment: String(sessionComment ?? '').trim() || null,
    ...(selfReport ? { selfReport } : {}),
  };
}
