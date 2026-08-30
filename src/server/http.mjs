export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workbench-Token, X-File-Name');
}

export function noReferrer(res) { res.setHeader('Referrer-Policy', 'no-referrer'); }

export function json(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function parseQuery(reqUrl) {
  return Object.fromEntries(new URL(reqUrl, 'http://localhost').searchParams.entries());
}

function bodyLimitError(message) {
  const error = new Error(message);
  error.code = 'BODY_TOO_LARGE';
  return error;
}

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function readRawBodyLimited(req, maxBytes) {
  return readLimited(req, maxBytes, '请求体超过大小上限');
}

function readLimited(req, maxBytes, message) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      req.resume(); reject(bodyLimitError(message)); return;
    }
    const chunks = []; let size = 0; let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) { settled = true; req.resume(); reject(bodyLimitError(message)); return; }
      chunks.push(buffer);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks, size)); } });
    req.on('error', reject);
  });
}

export function readBody(req, maxBytes = Infinity) {
  return readLimited(req, maxBytes, '请求体超过 2 MB 上限')
    .then((body) => JSON.parse(body.toString('utf8') || 'null'));
}
