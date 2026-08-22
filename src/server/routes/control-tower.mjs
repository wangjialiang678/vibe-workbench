export function controlTower(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/control-tower' && method === 'GET') {
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '控制塔仅限管理员访问' });
      return;
    }
    runtimeState.controlTowerService.snapshot({
      project: requestUrl.searchParams.get('project') || undefined,
      executor: requestUrl.searchParams.get('executor') || undefined,
      type: requestUrl.searchParams.get('type') || undefined,
      window: requestUrl.searchParams.get('window') || undefined,
      page: requestUrl.searchParams.get('page') || undefined,
      pageSize: requestUrl.searchParams.get('pageSize') || undefined,
    }).then((snapshot) => {
      json(res, 200, snapshot);
    }).catch((error) => {
      console.error('[workbench:control-tower] 聚合失败：', error.message);
      json(res, 500, { ok: false, error: '控制塔数据读取失败' });
    });
    return;
  }

  return false;
}
