const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// OTA 包与 web 导出的 source map 上传。OTA 是发给真实用户的代码：缺凭据必须失败
// （与 Android 发版的 sentry-upload 门禁同一口径），否则 OTA 之后的崩溃栈全是混淆的。
// web 导出目前只有 CI 的可部署性 smoke、没有正式部署，所以显式 --optional：缺凭据
// 跳过并警告。两种模式都不能把 .map 留在要部署的目录里（--delete-maps）。

const SCRIPT = path.join(process.cwd(), "scripts/upload-expo-sourcemaps.mjs");

function makeExport({ withMaps = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-export-"));
  const js = path.join(dir, "_expo", "static", "js", "web");
  fs.mkdirSync(js, { recursive: true });
  fs.writeFileSync(path.join(js, "entry.js"), "console.log(1)\n");
  if (withMaps) fs.writeFileSync(path.join(js, "entry.js.map"), "{}\n");
  return dir;
}

function fakeUploader({ exitCode = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-uploader-"));
  const log = path.join(dir, "calls.json");
  const script = path.join(dir, "upload.js");
  fs.writeFileSync(
    script,
    `require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), url: process.env.SENTRY_URL }));\nprocess.exit(${exitCode});\n`,
  );
  return { script, log };
}

function run(args, env = {}) {
  const clean = { PATH: process.env.PATH };
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...clean, ...env },
    encoding: "utf8",
  });
}

const CREDENTIALS = { SENTRY_AUTH_TOKEN: "sntrys_test", SENTRY_ORG: "windnote", SENTRY_PROJECT: "react-native" };

test("an OTA upload without Sentry credentials fails closed and names what is missing", () => {
  const dir = makeExport();
  const result = run([dir], { SENTRY_ORG: "windnote" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: SENTRY_AUTH_TOKEN, SENTRY_PROJECT\./);
});

test("an optional upload without credentials skips with a warning and still removes the maps", () => {
  const dir = makeExport();
  const result = run([dir, "--optional", "--delete-maps"], {});
  assert.equal(result.status, 0);
  assert.match(result.stderr, /skipping Sentry source map upload/i);
  assert.equal(fs.existsSync(path.join(dir, "_expo/static/js/web/entry.js.map")), false);
  assert.equal(fs.existsSync(path.join(dir, "_expo/static/js/web/entry.js")), true);
});

test("an export without source maps fails instead of uploading nothing", () => {
  const dir = makeExport({ withMaps: false });
  const result = run([dir], CREDENTIALS);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--source-maps/);
});

test("with credentials the SDK uploader runs against the export and maps can be removed after", () => {
  const dir = makeExport();
  const uploader = fakeUploader();
  const result = run([dir, "--delete-maps"], { ...CREDENTIALS, SENTRY_EXPO_UPLOAD_SCRIPT: uploader.script });
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(fs.readFileSync(uploader.log, "utf8"));
  assert.deepEqual(call.argv, [dir]);
  // 本仓的 Sentry 插件是裸字符串注册，SDK 脚本读不到插件里的 url，必须由环境给。
  assert.equal(call.url, "https://sentry.io/");
  assert.equal(fs.existsSync(path.join(dir, "_expo/static/js/web/entry.js.map")), false);
  assert.doesNotMatch(result.stdout + result.stderr, /sntrys_test/);
});

test("a failed upload fails the step", () => {
  const dir = makeExport();
  const uploader = fakeUploader({ exitCode: 3 });
  const result = run([dir], { ...CREDENTIALS, SENTRY_EXPO_UPLOAD_SCRIPT: uploader.script });
  assert.notEqual(result.status, 0);
});

test("web export and OTA scripts are wired to the uploader", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.match(pkg.scripts["export:web"], /expo export --platform web --source-maps/);
  assert.match(pkg.scripts["export:web"], /upload-expo-sourcemaps\.mjs dist --optional --delete-maps/);
  assert.match(pkg.scripts["sourcemaps:ota"], /upload-expo-sourcemaps\.mjs dist$/);
  const ci = fs.readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /name: Web Export[\s\S]*?run: npm run export:web/);
  const ota = fs.readFileSync(path.join(process.cwd(), "docs/ota-updates.md"), "utf8");
  assert.match(ota, /npm run sourcemaps:ota/);
});
