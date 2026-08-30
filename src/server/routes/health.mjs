export function health(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/health') {
    json(res, 200, { ok: true, ts: Date.now(), ...runtimeState.healthVersion });
    return;
  }

  return false;
}
