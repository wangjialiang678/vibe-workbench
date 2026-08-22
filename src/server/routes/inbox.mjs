const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: '*', path: '/api/inbox/', prefix: true, handler: legacy },
];
