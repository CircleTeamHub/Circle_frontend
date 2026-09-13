const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// test/ 下的跨仓契约测试按 `<前端根>/../circle_be` 读后端源码。任何跑这套测试的
// 工作流都必须先把后端放到同级目录，并断言源码在位，否则契约要么静默 skip，要么
// 写死读取的那条以 ENOENT 打红整次构建。#246 之后 main 上每次安卓预生产构建都红在
// 这里，而 ci.yml 自己检出了后端，所以 PR 上一直是绿的。

const SCRIPT = '.github/scripts/prepare-backend-contracts.sh';

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const TEST_STEP = /^\s+run:\s*npm (?:run ci|test)\s*$/m;

function jobs(workflow) {
  const body = workflow.slice(workflow.indexOf('\njobs:'));
  const headers = [...body.matchAll(/^  ([a-z][a-z0-9_-]*):\s*$/gm)];
  return headers.map((match, index) => ({
    name: match[1],
    text: body.slice(match.index, headers[index + 1]?.index ?? body.length),
  }));
}

function jobsRunningTests() {
  return fs
    .readdirSync(path.join(process.cwd(), '.github/workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((file) =>
      jobs(read(`.github/workflows/${file}`))
        .filter((job) => TEST_STEP.test(job.text))
        .map((job) => ({ file, ...job })),
    );
}

test('every job that runs the node test suite first puts circle_be beside the frontend', () => {
  const found = jobsRunningTests();
  const files = new Set(found.map((job) => job.file));
  // 防空转：已知的三处跑测试的工作流都必须被这条测试看见。
  for (const file of ['ci.yml', 'android-preprod-build.yml', 'android-release.yml']) {
    assert.ok(files.has(file), `${file} no longer runs the test suite in any job`);
  }

  for (const job of found) {
    const testAt = job.text.search(TEST_STEP);
    const provisionAt = job.text.search(
      /prepare-backend-contracts\.sh|repository: CircleTeamHub\/circle_be/,
    );
    assert.ok(
      provisionAt !== -1 && provisionAt < testAt,
      `${job.file} job "${job.name}" runs the test suite without circle_be beside it`,
    );
  }
});

test('the Android workflows pass the backend branch through the environment', () => {
  for (const [file, jobName] of [
    ['android-preprod-build.yml', 'build'],
    ['android-release.yml', 'preflight'],
  ]) {
    const job = jobs(read(`.github/workflows/${file}`)).find(
      (candidate) => candidate.name === jobName,
    );
    assert.ok(job, `${file} lost its ${jobName} job`);
    assert.match(job.text, /BACKEND_REF_CANDIDATE: \$\{\{ github\.ref_name \}\}/);
    assert.match(
      job.text,
      /^\s+run: bash \.github\/scripts\/prepare-backend-contracts\.sh\s*$/m,
    );
  }
});

test('the shared gate requires every backend source ci.yml requires, plus the DTO the inbox test reads', () => {
  const ci = read('.github/workflows/ci.yml');
  const script = read(SCRIPT);
  const ciFiles = [...ci.matchAll(/require_file \.\.\/circle_be\/(\S+)/g)].map(
    (match) => match[1],
  );
  const ciSymbols = [
    ...ci.matchAll(/require_symbol \.\.\/circle_be\/(\S+) (\S+)/g),
  ].map((match) => `${match[1]} ${match[2]}`);
  const scriptFiles = new Set(
    [...script.matchAll(/^require_file (\S+)$/gm)].map((match) => match[1]),
  );
  const scriptSymbols = new Set(
    [...script.matchAll(/^require_symbol (\S+) (\S+)$/gm)].map(
      (match) => `${match[1]} ${match[2]}`,
    ),
  );

  assert.ok(ciFiles.length > 0, 'ci.yml no longer lists backend contract files');
  for (const file of ciFiles) {
    assert.ok(scriptFiles.has(file), `${SCRIPT} does not require ${file}`);
  }
  for (const symbol of ciSymbols) {
    assert.ok(scriptSymbols.has(symbol), `${SCRIPT} does not require ${symbol}`);
  }
  // new-friends-inbox-tabs.test.js 写死读取它：缺了不是 skip 而是 ENOENT。
  assert.ok(scriptFiles.has('src/chat/chat.types.ts'));
});

const COMPLETE_BACKEND = {
  'src/chat/chat.constants.ts': 'export const CHAT_EVENTS = {};\n',
  'src/chat/chat.types.ts': 'export interface ChatConversationDto {}\n',
  'src/common/app-error-codes.ts': 'export const APP_ERROR_CODES = {};\n',
  'src/realtime/realtime.service.ts': 'broadcastMomentsFeedUpdated() {}\n',
};

function fakeBackend(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circle-be-contracts-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

const runGate = (backendDir) =>
  spawnSync('bash', [SCRIPT], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, BACKEND_CONTRACTS_DIR: backendDir, BACKEND_REF_CANDIDATE: '' },
  });

test('the gate passes on an existing complete backend without cloning again', () => {
  const dir = fakeBackend(COMPLETE_BACKEND);
  try {
    const result = runGate(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /OK: backend contract sources present/);
    assert.doesNotMatch(result.stdout, /Checked out circle_be/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the gate fails loudly when a pinned backend file or producer symbol is gone', () => {
  const scenarios = [
    {
      name: 'DTO file removed',
      files: { ...COMPLETE_BACKEND, 'src/chat/chat.types.ts': undefined },
      error: /::error::circle_be\/src\/chat\/chat\.types\.ts not found/,
    },
    {
      name: 'producer renamed',
      files: { ...COMPLETE_BACKEND, 'src/realtime/realtime.service.ts': 'renamed() {}\n' },
      error:
        /::error::circle_be\/src\/realtime\/realtime\.service\.ts no longer defines broadcastMomentsFeedUpdated/,
    },
  ];

  for (const scenario of scenarios) {
    const files = Object.fromEntries(
      Object.entries(scenario.files).filter(([, content]) => content !== undefined),
    );
    const dir = fakeBackend(files);
    try {
      const result = runGate(dir);
      assert.equal(result.status, 1, scenario.name);
      assert.match(result.stdout, scenario.error, scenario.name);
      assert.doesNotMatch(result.stdout, /OK: backend contract sources present/, scenario.name);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
