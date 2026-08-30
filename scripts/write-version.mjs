#!/usr/bin/env node
// 部署前生成 version.json；服务进程只读该文件，不在运行时探测 git。
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suppliedCommit = process.argv[2];
const commit = suppliedCommit || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

if (!commit) throw new Error('未获得部署 commit；请传入 commit 或在 git 工作树中执行');
await writeFile(path.join(root, 'version.json'), `${JSON.stringify({ commit }, null, 2)}\n`, 'utf8');
console.log(`已写入 version.json: ${commit}`);
