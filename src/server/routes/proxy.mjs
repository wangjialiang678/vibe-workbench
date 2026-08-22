const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: '*', path: '/api/proxy', handler: legacy },
];
