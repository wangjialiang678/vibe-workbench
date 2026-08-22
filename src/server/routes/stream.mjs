const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '/api/messages', handler: legacy },
  { method: 'POST', path: '/api/messages', handler: legacy },
  { method: 'POST', path: '/api/stream-events', handler: legacy },
];
