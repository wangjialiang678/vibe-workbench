import { routes as healthRoutes } from './health.mjs';
import { routes as controlTowerRoutes } from './control-tower.mjs';
import { routes as inboxRoutes } from './inbox.mjs';
import { routes as workerRoutes } from './worker.mjs';
import { routes as documentsRoutes } from './documents.mjs';
import { routes as streamRoutes } from './stream.mjs';
import { routes as participantsRoutes } from './participants.mjs';
import { routes as assetsRoutes } from './assets.mjs';
import { routes as projectsRoutes } from './projects.mjs';
import { routes as sessionRoutes } from './session.mjs';
import { routes as feedbackRoutes } from './feedback.mjs';
import { routes as proxyRoutes } from './proxy.mjs';
import { routes as pagesRoutes } from './pages.mjs';

// 与旧 if/else 的声明顺序一致：前缀路由和 GET 页面兜底必须留在其原有位置。
export const routes = [
  ...healthRoutes,
  ...controlTowerRoutes,
  ...inboxRoutes,
  ...workerRoutes,
  ...documentsRoutes,
  ...streamRoutes,
  ...participantsRoutes.slice(0, 1),
  ...assetsRoutes.slice(0, 2),
  ...projectsRoutes,
  ...participantsRoutes.slice(1),
  ...sessionRoutes.slice(0, 1),
  ...feedbackRoutes.slice(0, 1),
  ...sessionRoutes.slice(1, 3),
  ...feedbackRoutes.slice(1),
  ...proxyRoutes,
  ...sessionRoutes.slice(3),
  ...assetsRoutes.slice(2),
  ...pagesRoutes,
];

export function matchRoute(method, urlPath) {
  return routes.find((route) => (
    (route.method === '*' || route.method === method)
    && (route.path === '*' || (route.prefix ? urlPath.startsWith(route.path) : urlPath === route.path))
  )) || null;
}
