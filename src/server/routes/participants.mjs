const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '/api/participants-public', handler: legacy },
  { method: '*', path: '/api/participants', handler: legacy },
  { method: '*', path: '/api/participants/', prefix: true, handler: legacy },
];
