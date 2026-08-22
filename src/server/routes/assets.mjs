const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'POST', path: '/api/attachments', handler: legacy },
  { method: 'GET', path: '/api/assets', handler: legacy },
  { method: 'GET', path: '/assets/', prefix: true, handler: legacy },
];
