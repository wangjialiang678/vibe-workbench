const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '/api/sessions', handler: legacy },
  { method: 'GET', path: '/api/projects', handler: legacy },
  { method: 'GET', path: '/api/session-context', handler: legacy },
];
