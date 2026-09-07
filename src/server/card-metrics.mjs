// 盲判试点的逐卡原始度量；聚合由 CLI 读取此事实源完成。
export function cardMetricsForFeedback(content, feedback) {
  const submittedAt = feedback.submittedAt;
  return (content?.blocks ?? []).filter((block) => block?.type === 'choice').map((block) => {
    const item = (feedback.items ?? []).find((candidate) => candidate?.blockId === block.id && candidate.type === 'select');
    const openedAt = item?.openedAt ?? submittedAt;
    const openedMs = Date.parse(openedAt);
    const submittedMs = Date.parse(submittedAt);
    return {
      blockId: block.id, mode: block.mode ?? 'quick', judgmentKind: block.judgmentKind ?? null,
      recommendation: block.recommendation ?? null, selected: item?.value ?? null,
      changedFromRecommendation: Boolean(item?.value && block.recommendation && item.value !== block.recommendation),
      predictionProvided: Boolean(String(item?.prediction ?? '').trim()), premisesProvided: Boolean(String(item?.premises ?? '').trim()),
      openedAt, submittedAt, dwellMs: Number.isFinite(openedMs) && Number.isFinite(submittedMs) ? Math.max(0, submittedMs - openedMs) : 0,
    };
  });
}

export function summarizeCardMetrics(metrics) {
  const groups = new Map();
  for (const metric of metrics) {
    const group = groups.get(metric.mode) ?? { mode: metric.mode, cards: 0, submitted: 0, changed: 0, prediction: 0, premises: 0, dwellMs: 0 };
    group.cards += 1; if (metric.selected != null) group.submitted += 1; if (metric.changedFromRecommendation) group.changed += 1;
    if (metric.predictionProvided) group.prediction += 1; if (metric.premisesProvided) group.premises += 1; group.dwellMs += metric.dwellMs; groups.set(metric.mode, group);
  }
  return [...groups.values()].map((group) => ({ mode: group.mode, cards: group.cards,
    submissionRate: group.cards ? group.submitted / group.cards : 0, changedFromRecommendationRate: group.submitted ? group.changed / group.submitted : 0,
    predictionCaptureRate: group.submitted ? group.prediction / group.submitted : 0, premisesCaptureRate: group.submitted ? group.premises / group.submitted : 0,
    averageDwellMs: group.cards ? Math.round(group.dwellMs / group.cards) : 0 }));
}
