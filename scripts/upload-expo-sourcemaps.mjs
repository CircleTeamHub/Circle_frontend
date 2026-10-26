#!/usr/bin/env node
/**
 * 把 `expo export` / `eas update` 产出目录里的 source map 传到 Sentry。
 *
 * 用法：node scripts/upload-expo-sourcemaps.mjs <export-dir> [--optional] [--delete-maps]
 *       node scripts/upload-expo-sourcemaps.mjs --check
 *
 * - --check：只校验凭据。OTA 要在 `eas update` 发布之前跑：上传一步在发布之后，
 *   缺凭据到那时才发现，更新已经在用户手里了。
 * - 默认 fail-closed：缺 SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT 直接失败。OTA 包
 *   是发给真实用户的代码，缺 map 的话 OTA 之后的崩溃栈全是混淆过的 —— 与 Android 发版
 *   工作流的 sentry-upload 门禁同一口径。
 * - --optional：缺凭据时明确跳过并警告（web 导出目前只有 CI 的可部署性 smoke）。
 * - --delete-maps：上传（或跳过）之后删掉目录里的 .map，免得随 web 部署公开源码。
 *
 * 匹配靠 debug ID（metro.config.js 的 getSentryExpoConfig 注入），不依赖 release/dist。
 * 本仓 Sentry 插件是裸字符串注册、没有 url 配置，SDK 脚本读不到时会直接退出，所以
 * SENTRY_URL 在这里给默认值（与插件写进 sentry.properties 的默认值一致）。
 * 凭据只通过环境变量传给 SDK 脚本，本脚本不打印任何值。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REQUIRED_ENV = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const DEFAULT_SENTRY_URL = 'https://sentry.io/';
const DEFAULT_UPLOADER = 'node_modules/@sentry/react-native/scripts/expo-upload-sourcemaps.js';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function findSourceMaps(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return findSourceMaps(full);
    return entry.endsWith('.map') ? [full] : [];
  });
}

function deleteSourceMaps(maps) {
  for (const file of maps) rmSync(file);
  console.log(`Removed ${maps.length} source map file(s) from the export.`);
}

const args = process.argv.slice(2);
const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());

if (args.includes('--check')) {
  if (missing.length > 0) {
    fail(`Sentry source map upload config is missing: ${missing.join(', ')}.`);
  }
  console.log('Sentry source map upload config is present.');
  process.exit(0);
}

const optional = args.includes('--optional');
const deleteMaps = args.includes('--delete-maps');
const exportDir = args.find((arg) => !arg.startsWith('--'));

if (!exportDir) fail('usage: upload-expo-sourcemaps.mjs <export-dir> [--optional] [--delete-maps]');
if (!existsSync(exportDir) || !statSync(exportDir).isDirectory()) {
  fail(`export directory not found: ${exportDir}`);
}

const maps = findSourceMaps(exportDir);

if (missing.length > 0) {
  if (!optional) {
    fail(
      `Sentry source map upload config is missing: ${missing.join(', ')}. ` +
        'Set them before publishing, otherwise crash stacks from this bundle stay minified.',
    );
  }
  console.error(
    `warning: skipping Sentry source map upload, missing: ${missing.join(', ')}.`,
  );
  if (deleteMaps) deleteSourceMaps(maps);
  process.exit(0);
}

if (maps.length === 0) {
  fail(`no .map files under ${exportDir}; export with --source-maps before uploading.`);
}

const uploader = resolve(process.env.SENTRY_EXPO_UPLOAD_SCRIPT || DEFAULT_UPLOADER);
const upload = spawnSync(process.execPath, [uploader, exportDir], {
  stdio: 'inherit',
  env: { ...process.env, SENTRY_URL: process.env.SENTRY_URL?.trim() || DEFAULT_SENTRY_URL },
});
if (upload.status !== 0) {
  fail(`Sentry source map upload failed (exit ${upload.status ?? 'signal'}).`);
}

if (deleteMaps) deleteSourceMaps(maps);
