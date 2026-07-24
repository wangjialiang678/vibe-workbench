import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp;
let migration;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-project-migration-'));
  process.env.WB_WORKSPACE = tmp;
  migration = await import('../../scripts/migrate-projects-v1.mjs');
});

after(() => {
  delete process.env.WB_WORKSPACE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function snapshot(directory) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else result[path.relative(directory, target)] = fs.readFileSync(target, 'utf8');
    }
  }
  visit(directory);
  return result;
}

test('迁移在任一目标会话缺失时先中止，不留下半成品注册表', () => {
  assert.throws(() => migration.migrateProjectsV1(), /迁移中止/);
  assert.equal(fs.existsSync(path.join(tmp, 'projects.json')), false);
});

test('迁移可连续执行两次且结果逐字节一致，项目记忆不会串项目', () => {
  for (const session of Object.keys(migration.SESSIONS_V1)) {
    fs.mkdirSync(path.join(tmp, session), { recursive: true });
  }

  const firstResult = migration.migrateProjectsV1();
  const firstSnapshot = snapshot(tmp);
  const secondResult = migration.migrateProjectsV1();

  assert.deepEqual(secondResult, firstResult);
  assert.deepEqual(snapshot(tmp), firstSnapshot);
  for (const project of migration.PROJECTS_V1) {
    assert.equal(project.memoryPath.endsWith(`/${project.id}`), true);
  }
});
