const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = process.cwd();
const workflowDir = path.join(repoRoot, '.github/workflows');
const retryScript = path.join(repoRoot, '.github/scripts/install-skia-with-retry.sh');
const read = (name) => fs.readFileSync(path.join(workflowDir, name), 'utf8');

// Skia 的 postinstall 从 GitHub Releases 下载几百 MB 预编译包,遇到 504 不重试,
// 一次抖动就会让整个 npm ci 失败。安装依赖时一律跳过,需要这些文件的任务单独带重试下载。
const NATIVE_INSTALLS = {
  'android-preprod-build.yml': 1,
  'daily-android-build.yml': 1,
  'android-release.yml': 1,
};

test('every npm ci in every workflow leaves the Skia download out of the install', () => {
  for (const name of fs.readdirSync(workflowDir)) {
    const lines = read(name).split('\n');
    lines.forEach((line, index) => {
      if (line.trim() !== 'run: npm ci') return;
      const step = lines.slice(Math.max(0, index - 3), index).join('\n');
      assert.match(step, /SKIP_SKIA_DOWNLOAD: '1'/, `${name}:${index + 1}`);
    });
  }
});

test('jobs that need the Skia binaries fetch them with retries right after installing', () => {
  for (const [name, expected] of Object.entries(NATIVE_INSTALLS)) {
    const source = read(name);
    const installs = source.match(/run: npm ci\n\n\s+- name: Download Skia binaries\n\s+run: bash \.github\/scripts\/install-skia-with-retry\.sh/g) ?? [];
    assert.equal(installs.length, expected, name);
  }
});

test('Verify and the Windows tests do not fetch Skia binaries at all', () => {
  assert.doesNotMatch(read('ci.yml'), /install-skia-with-retry/);
});

test('release steps that never compile native code do not depend on Skia downloads', () => {
  assert.doesNotMatch(read('ios-release.yml'), /install-skia-with-retry/);
  const preflight = read('android-release.yml').split(/\n  build:\n/)[0];
  assert.match(preflight, /\n  preflight:\n/);
  assert.doesNotMatch(preflight, /install-skia-with-retry/);
});

test('the actionlint download survives a transient 5xx', () => {
  assert.match(read('ci.yml'), /curl -fsSL --retry 5 --retry-delay 5 \\\n\s+-o actionlint\.tar\.gz/);
});

function runRetryScript({ failures, attempts = '3', env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skia-retry-'));
  const scriptDir = path.join(dir, 'node_modules/@shopify/react-native-skia/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  const counter = path.join(dir, 'runs');
  fs.writeFileSync(path.join(scriptDir, 'install-skia.mjs'), `
    import fs from 'node:fs';
    const seen = fs.existsSync(${JSON.stringify(counter)}) ? fs.readFileSync(${JSON.stringify(counter)}, 'utf8').split('\\n').filter(Boolean) : [];
    seen.push(process.env.SKIP_SKIA_DOWNLOAD ?? 'unset');
    fs.writeFileSync(${JSON.stringify(counter)}, seen.join('\\n'));
    process.exit(seen.length > ${failures} ? 0 : 1);
  `);
  const result = spawnSync('bash', [retryScript], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, SKIA_INSTALL_ATTEMPTS: attempts, SKIA_INSTALL_RETRY_DELAY_SECONDS: '0', ...env },
  });
  const runs = fs.readFileSync(counter, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, runs, output: `${result.stdout}${result.stderr}` };
}

test('a transient download failure is retried until it succeeds', () => {
  const { status, runs } = runRetryScript({ failures: 2 });
  assert.equal(status, 0);
  assert.equal(runs.length, 3);
});

test('a persistent failure stops after the last attempt and fails the job visibly', () => {
  const { status, runs, output } = runRetryScript({ failures: 99 });
  assert.equal(status, 1);
  assert.equal(runs.length, 3);
  assert.match(output, /::error::/);
});

test('a job-level skip flag cannot silently turn the download into a no-op', () => {
  const { runs } = runRetryScript({ failures: 0, env: { SKIP_SKIA_DOWNLOAD: '1' } });
  assert.deepEqual(runs, ['unset']);
});
