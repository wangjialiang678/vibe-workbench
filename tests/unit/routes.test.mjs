import test from 'node:test';
import assert from 'node:assert/strict';

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
