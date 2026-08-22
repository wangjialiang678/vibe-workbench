import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchRoute, routes } from '../../src/server/routes/index.mjs';

test('routes：精确、前缀与页面兜底按声明顺序匹配', () => {
  assert.equal(matchRoute('GET', '/api/health').path, '/api/health');
  assert.equal(matchRoute('POST', '/api/health').path, '/api/health');
  assert.equal(matchRoute('POST', '/api/inbox/tasks').path, '/api/inbox/');
  assert.equal(matchRoute('GET', '/assets/demo/a.png').path, '/assets/');
  assert.equal(matchRoute('GET', '/render/index.html').path, '*');
  assert.equal(matchRoute('POST', '/api/missing'), null);
});

test('routes：前缀资产路由在页面 GET 兜底前', () => {
  const asset = routes.findIndex((route) => route.path === '/assets/');
  const pages = routes.findIndex((route) => route.path === '*');
  assert.ok(asset >= 0);
  assert.ok(pages > asset);
});

test('routes：注册 handler 不得退化为 legacy 转发', () => {
  for (const route of routes) {
    assert.doesNotMatch(route.handler.toString(), /legacy/);
  }
});

test('routes：token/identity 前置于路由查表，未知 API 仍由鉴权返回 403', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = readFileSync(path.resolve(here, '../../src/server/server.mjs'), 'utf8');
  const identity = server.indexOf('resolveRequestIdentity(');
  const table = server.indexOf('matchRoute(method, urlPath)');
  assert.ok(identity >= 0 && table > identity, 'token/identity 解析必须在路由查表之前');
  assert.match(server, /访问被拒绝：令牌缺失或无效/);
});
