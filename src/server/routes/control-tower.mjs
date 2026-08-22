const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '/api/control-tower', handler: legacy },
];
