const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BASE_APP_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'),
).expo;

// 预发包每次推 main 都会发一版。versionCode 必须逐版变大：一样的话，已装的手机点新包
// 只会「打开」、装不上去，只能卸载重装 —— 登录态和设备 ID 也跟着没了。取「基数 + 这次
// 构建的提交在 main 上的提交数」：main 只往前走，新版本号必然更大；同一提交重建得到同一个号。
// 基数让它高过 app.json 原来的 1000001（已经装着那一版的手机也能直接覆盖）。
const PREPROD_VERSION_CODE_BASE = 100_000_000;

function preprodVersionCode(commitCount) {
  if (!Number.isSafeInteger(commitCount) || commitCount < 1) {
    throw new Error(`commit count must be a positive integer, got ${commitCount}`);
  }
  return PREPROD_VERSION_CODE_BASE + commitCount;
}

const EXPECTED = Object.freeze({
  version: BASE_APP_CONFIG.version,
  packageName: 'com.yiboding.circleim.preprod',
  appName: '风信测试版',
  appVariant: 'preprod',
  apiUrl: 'https://api-43-134-85-95.sslip.io',
  apiHost: 'api-43-134-85-95.sslip.io',
  // 顺序即 EXPO_PUBLIC_MEDIA_ORIGINS 的逗号顺序。保留 COS/API 旧媒体来源和回滚路径，
  // R2 公开目录走 Worker，私有媒体的预签名地址直连 R2 S3 API。少了哪个来源，
  // App 都会把那一类媒体整片丢掉。
  mediaOrigins: Object.freeze([
    'https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
    'https://api-43-134-85-95.sslip.io',
    'https://windnote-media-preprod-delivery.yiboding1998.workers.dev',
    'https://0bea489023c1d8692a19dadaf15dcf95.r2.cloudflarestorage.com',
  ]),
  mediaHosts: Object.freeze([
    'windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
    'api-43-134-85-95.sslip.io',
    'windnote-media-preprod-delivery.yiboding1998.workers.dev',
    '0bea489023c1d8692a19dadaf15dcf95.r2.cloudflarestorage.com',
  ]),
  forbiddenStrings: [
    'application-diary-papua-dining.trycloudflare.com',
    // 东京旧测试机 2026-10 到期、IP 已易主;sslip 域名跟着 IP 走,包里绝不能再出现。
    'api-43-133-201-42.sslip.io',
    'media-43-133-201-42.sslip.io',
    'EXPO_PUBLIC_OPENIM_API_URL',
    'EXPO_PUBLIC_OPENIM_WS_URL',
    '@openim/rn-client-sdk',
  ],
});

function isExactHttpsUrl(value, expected) {
  if (value !== expected) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === '/' &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function validateMetadata({ app, env }) {
  const errors = [];
  if (app?.version !== EXPECTED.version) {
    errors.push(`App version must be ${EXPECTED.version}.`);
  }
  const derivedVersionCode = Number(env.ANDROID_PREPROD_VERSION_CODE);
  if (
    !Number.isSafeInteger(derivedVersionCode) ||
    derivedVersionCode <= PREPROD_VERSION_CODE_BASE
  ) {
    errors.push(
      'ANDROID_PREPROD_VERSION_CODE must be derived from main history (verify-android-preprod.js version-code).',
    );
  } else if (app?.android?.versionCode !== derivedVersionCode) {
    errors.push(`Android versionCode must be ${derivedVersionCode}.`);
  }
  if (app?.android?.package !== EXPECTED.packageName) {
    errors.push(`Android package must be ${EXPECTED.packageName}.`);
  }
  if (app?.name !== EXPECTED.appName) {
    errors.push(`App name must be ${EXPECTED.appName}.`);
  }
  if (app?.extra?.appVariant !== EXPECTED.appVariant) {
    errors.push(`App variant must be ${EXPECTED.appVariant}.`);
  }
  if (!isExactHttpsUrl(env.EXPO_PUBLIC_API_URL, EXPECTED.apiUrl)) {
    errors.push(`EXPO_PUBLIC_API_URL must be ${EXPECTED.apiUrl}.`);
  }
  if (!isExactHttpsUrl(env.EXPO_PUBLIC_CHAT_WS_URL, EXPECTED.apiUrl)) {
    errors.push(`EXPO_PUBLIC_CHAT_WS_URL must be ${EXPECTED.apiUrl}.`);
  }
  const mediaOrigins = String(env.EXPO_PUBLIC_MEDIA_ORIGINS ?? '').split(',');
  const mediaOriginsExact =
    mediaOrigins.length === EXPECTED.mediaOrigins.length &&
    EXPECTED.mediaOrigins.every((expected, index) =>
      isExactHttpsUrl(mediaOrigins[index], expected),
    );
  if (!mediaOriginsExact) {
    errors.push(
      `EXPO_PUBLIC_MEDIA_ORIGINS must be ${EXPECTED.mediaOrigins.join(',')}.`,
    );
  }
  return errors;
}

function validateApkContents(contents) {
  const haystack = contents.toString('latin1').toLowerCase();
  const errors = [];
  for (const [label, expected] of [
    ['API host', EXPECTED.apiHost],
    ...EXPECTED.mediaHosts.map((host) => ['media host', host]),
  ]) {
    if (!haystack.includes(expected.toLowerCase())) {
      errors.push(`APK is missing expected ${label}: ${expected}`);
    }
  }
  for (const forbidden of EXPECTED.forbiddenStrings) {
    if (haystack.includes(forbidden.toLowerCase())) {
      errors.push(`APK contains forbidden preproduction value: ${forbidden}`);
    }
  }
  return errors;
}

function validateAndroidManifest(contents) {
  const errors = [];
  const hasScheme = (scheme) =>
    contents.includes(`android:scheme="${scheme}"`) ||
    contents.includes(`android:scheme='${scheme}'`);

  for (const scheme of ['windnoteai-preprod', 'circleim-preprod']) {
    if (!hasScheme(scheme)) {
      errors.push(`Android manifest is missing preproduction scheme: ${scheme}`);
    }
  }
  for (const scheme of ['windnoteai', 'circleim']) {
    if (hasScheme(scheme)) {
      errors.push(`Android manifest still registers production scheme: ${scheme}`);
    }
  }
  return errors;
}

function failOnErrors(errors) {
  if (errors.length === 0) return;
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
}

function verifyApk(apkPath, run = spawnSync) {
  if (!apkPath || !fs.statSync(apkPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`APK does not exist: ${apkPath || '[missing path]'}`);
  }
  const archiveCheck = run('unzip', ['-tqq', apkPath], {
    encoding: 'utf8',
  });
  if (archiveCheck.error || archiveCheck.status !== 0) {
    throw new Error(
      `APK is not a valid ZIP archive: ${archiveCheck.error?.message || archiveCheck.stderr}`,
    );
  }
  const extracted = run('unzip', ['-p', apkPath], {
    encoding: null,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (extracted.error || extracted.status !== 0 || !extracted.stdout?.length) {
    throw new Error(
      `Unable to inspect APK contents: ${extracted.error?.message || extracted.stderr}`,
    );
  }
  const errors = validateApkContents(extracted.stdout);
  if (errors.length > 0) {
    throw new Error(`APK endpoint verification failed:\n${errors.join('\n')}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const [command, argument] = argv;
  if (command === 'metadata') {
    const configPath = path.join(process.cwd(), 'app.config.js');
    delete require.cache[require.resolve(configPath)];
    const app = require(configPath)();
    failOnErrors(validateMetadata({ app, env: process.env }));
    return;
  }
  if (command === 'apk') {
    verifyApk(argument);
    return;
  }
  if (command === 'version-code') {
    const git = (...args) => {
      const result = spawnSync('git', args, { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
      }
      return result.stdout.trim();
    };
    // 浅克隆只数得到 1 个提交，版本号会倒退成装不上去的旧号：必须是完整历史。
    if (git('rev-parse', '--is-shallow-repository') !== 'false') {
      throw new Error('version-code needs full history (actions/checkout fetch-depth: 0).');
    }
    process.stdout.write(`${preprodVersionCode(Number(git('rev-list', '--count', 'HEAD')))}\n`);
    return;
  }
  if (command === 'manifest') {
    const contents = fs.readFileSync(argument, 'utf8');
    failOnErrors(validateAndroidManifest(contents));
    return;
  }
  throw new Error(
    'Usage: verify-android-preprod.js <metadata|manifest|apk|version-code> [file-path]',
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED,
  PREPROD_VERSION_CODE_BASE,
  main,
  preprodVersionCode,
  validateApkContents,
  validateAndroidManifest,
  validateMetadata,
  verifyApk,
};
