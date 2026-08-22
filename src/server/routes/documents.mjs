const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '/api/documents', handler: legacy },
  { method: 'POST', path: '/api/documents', handler: legacy },
];
