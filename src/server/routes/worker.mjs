const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'POST', path: '/api/worker-heartbeat', handler: legacy },
];
