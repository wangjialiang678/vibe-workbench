const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '/api/feedback', handler: legacy },
  { method: 'POST', path: '/api/feedback', handler: legacy },
];
