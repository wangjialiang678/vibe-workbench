import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { disk } from '../storage/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SRC_ROOT = path.resolve(__dirname, '..');
export const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };
const ASSET_VERSION_FILES = ['render/index.html', 'render/app.mjs', 'render/app.css', 'render/theme.css', 'render/blocks.mjs', 'render/attention-view.mjs', 'render/batch-select.mjs', 'render/readonly-view.mjs', 'protocol/decision-makers.mjs', 'render/vendor/mermaid.min.js'];
export function assetsVersion() { let latest = 0; for (const rel of ASSET_VERSION_FILES) { try { const time = disk.statSync(path.join(SRC_ROOT, rel)).mtimeMs; if (time > latest) latest = time; } catch {} } return String(Math.round(latest)); }
