// tab 分面导航的状态计算。

export function pickFacet(groups, wantedFacet, draft, pendingStats) {
  if (wantedFacet) {
    const byName = groups.findIndex((group) => group.section === wantedFacet);
    const byIndex = Number.isInteger(Number(wantedFacet)) ? Number(wantedFacet) : -1;
    const hit = byName !== -1 ? byName : (groups[byIndex] ? byIndex : -1);
    if (hit !== -1) return hit;
  }

  let idx = groups.findIndex((group) => group.blocks.length && pendingStats(group.blocks, draft).must > 0);
  if (idx === -1) idx = groups.findIndex((group) => group.blocks.length);
  return idx === -1 ? 0 : idx;
}

export function facetBadgeState(stats) {
  const must = Number(stats?.must) || 0;
  const optional = Number(stats?.optional) || 0;
  return {
    count: must + optional,
    level: must > 0 ? 'must' : (optional > 0 ? 'optional' : 'done'),
  };
}

export function facetBadges(groups, draft, pendingStats) {
  return groups.map((group) => facetBadgeState(pendingStats(group.blocks, draft)));
}
