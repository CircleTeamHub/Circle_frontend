const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('secret-bearing fixtures and generated performance artifacts are ignored', () => {
  const ignore = read('.gitignore');
  for (const pattern of [
    'e2e/.env*',
    '!e2e/env.example',
    'load-tests/data/*.json',
    '!load-tests/data/accounts.example.json',
    'test-results/',
    '*.perfetto-trace',
    '*.trace/',
  ]) {
    assert.match(ignore, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('examples are fake, disabled, and contain every required safety switch', () => {
  const env = read('e2e/env.example');
  assert.match(env, /E2E_EXECUTE=false/);
  assert.match(env, /E2E_ALLOW_MUTATION=false/);
  assert.match(env, /LOAD_EXECUTE=false/);
  assert.match(env, /LOAD_ALLOW_MUTATION=false/);
  assert.match(env, /LOAD_PERFORMANCE_FIXTURE=false/);
  assert.match(env, /\.example|\.test/);
  assert.doesNotMatch(env, /api\.windnote\.ai/);
  assert.doesNotMatch(env, /eyJ[A-Za-z0-9_-]{20,}\./);
});

test('E2E and load documentation covers setup, fixtures, commands, thresholds, and deferred devices', () => {
  const e2e = read('e2e/README.md');
  const fixtures = read('e2e/fixtures.md');
  const load = read('load-tests/README.md');
  for (const command of [
    'npm run e2e:all',
    'npm run perf:android',
    'npm run perf:ios',
    'npm run test:testing-tools',
  ]) {
    assert.match(e2e, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(e2e, /Android/i);
  assert.match(e2e, /iOS/i);
  assert.match(e2e, /真机.*尚未|deferred/i);
  // 被测包必须是 EXPO_PUBLIC_E2E_BUILD=1 的构建，否则 launch 子流程的目标断言必失败。
  assert.match(e2e, /EXPO_PUBLIC_E2E_BUILD=1/);
  assert.match(read('e2e/env.example'), /EXPO_PUBLIC_E2E_BUILD=1/);
  assert.match(fixtures, /E2E_PERF_CONVERSATION_ID/);
  assert.match(fixtures, /不得.*生产|production/i);
  for (const scenario of ['chat-send', 'chat-fan-in', 'circle-join', 'inbox-seed']) {
    assert.match(load, new RegExp(scenario));
  }
  assert.match(load, /p\(95\)|95/);
  assert.match(load, /逐级|ramp/i);
});

test('CI runs only the fast credential-free testing contract gate', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /npm run test:testing-tools/);
  assert.doesNotMatch(ci, /npm run e2e:all|npm run load:|npm run perf:/);
});

test('root README links the complete testing guides', () => {
  const readme = read('README.md');
  assert.match(readme, /e2e\/README\.md/);
  assert.match(readme, /load-tests\/README\.md/);
  assert.match(readme, /Maestro/);
  assert.match(readme, /k6/);
});
