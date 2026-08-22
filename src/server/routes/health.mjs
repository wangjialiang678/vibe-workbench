const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: '*', path: '/api/health', handler: legacy },
];
