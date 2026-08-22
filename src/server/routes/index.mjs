import { health } from './health.mjs';
import { controlTower } from './control-tower.mjs';
import { inbox } from './inbox.mjs';
import { worker } from './worker.mjs';
import { documentsGet, documentsPost } from './documents.mjs';
import { messagesGet, messagesPost, streamEvents } from './stream.mjs';
import { participantsPublic, participants } from './participants.mjs';
import { attachments, assetsApi, sessionAssets } from './assets.mjs';
import { sessions, projects, sessionContext } from './projects.mjs';
import { rounds, status, content, retry } from './session.mjs';
import { feedbackGet, feedbackPost } from './feedback.mjs';
import { proxy } from './proxy.mjs';
import { pages } from './pages.mjs';
const exact = new Map();
for (const [method, path, handler] of [['*','/api/health',health],['GET','/api/control-tower',controlTower],['POST','/api/worker-heartbeat',worker],['GET','/api/documents',documentsGet],['POST','/api/documents',documentsPost],['GET','/api/messages',messagesGet],['POST','/api/messages',messagesPost],['GET','/api/participants-public',participantsPublic],['POST','/api/stream-events',streamEvents],['POST','/api/attachments',attachments],['GET','/api/assets',assetsApi],['GET','/api/sessions',sessions],['GET','/api/projects',projects],['GET','/api/session-context',sessionContext],['POST','/api/rounds',rounds],['GET','/api/feedback',feedbackGet],['GET','/api/status',status],['GET','/api/content',content],['POST','/api/feedback',feedbackPost],['*','/api/proxy',proxy],['POST','/api/retry',retry]]) exact.set(method+' '+path,{method,path,handler});
export const prefixRoutes=[{method:'*',path:'/api/inbox/',handler:inbox},{method:'*',path:'/api/participants/',handler:participants},{method:'*',path:'/api/participants',handler:participants},{method:'GET',path:'/assets/',handler:sessionAssets},{method:'GET',path:'*',handler:pages}];
export const routes=[...exact.values(),...prefixRoutes];
export function matchRoute(method,urlPath){return exact.get(method+' '+urlPath)||exact.get('* '+urlPath)||prefixRoutes.find(r=>(r.method==='*'||r.method===method)&&(r.path==='*'||urlPath.startsWith(r.path)))||null;}
