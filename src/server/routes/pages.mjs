const legacy = ({ legacy }) => legacy();

export const routes = [
  { method: 'GET', path: '*', handler: legacy },
];
