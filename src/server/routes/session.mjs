const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'POST', path: '/api/rounds', handler: legacy },
  { method: 'GET', path: '/api/status', handler: legacy },
  { method: 'GET', path: '/api/content', handler: legacy },
  { method: 'POST', path: '/api/retry', handler: legacy },
];
