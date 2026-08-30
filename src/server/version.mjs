// 部署元数据只在服务启动时读取；HTTP 请求路径绝不调用 git。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(file, readFile) {
  try {
    return JSON.parse(readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readHealthVersion({ root = projectRoot, readFile = readFileSync } = {}) {
  const packageInfo = readJson(path.join(root, 'package.json'), readFile);
  const deployInfo = readJson(path.join(root, 'version.json'), readFile);
  return {
    version: typeof packageInfo?.version === 'string' ? packageInfo.version : 'unknown',
    commit: typeof deployInfo?.commit === 'string' && deployInfo.commit ? deployInfo.commit : 'unknown',
  };
}
