// 轮次解析 / 自动推进的纯逻辑。

export function pickRound(urlRound, latestRound) {
  return urlRound !== '' ? Number(urlRound) : (latestRound ?? 1);
}

export function nextRoundTitle(round, appTitle) {
  return `第 ${round} 轮 — ${appTitle || 'Vibe Coding工作台'}`;
}

export function shouldAdvance(currentRound, statusRound) {
  return currentRound != null && Number.isInteger(statusRound) && statusRound > currentRound;
}
