const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED = Object.freeze({
  version: '1.0.1',
  versionCode: 1000001,
  packageName: 'com.yiboding.circleim.preprod',
  appName: '风信测试版',
  appVariant: 'preprod',
  apiUrl: 'https://api-43-133-201-42.sslip.io',
  apiHost: 'api-43-133-201-42.sslip.io',
  // 顺序即 EXPO_PUBLIC_MEDIA_ORIGINS 的逗号顺序。COS 直连域名给私有媒体的预签名
  // 地址用;限流的投递域名是后端 OBJECT_STORAGE_DELIVERY_URL,公开目录(头像、
  // 封面……)的永久地址由它拼出。少了哪个,App 都会把那一类媒体整片丢掉。
  mediaOrigins: Object.freeze([
    'https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
    'https://media-43-133-201-42.sslip.io',
  ]),
  mediaHosts: Object.freeze([
    'windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
    'media-43-133-201-42.sslip.io',
  ]),
  forbiddenStrings: [
    'application-diary-papua-dining.trycloudflare.com',
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
  if (app?.android?.versionCode !== EXPECTED.versionCode) {
    errors.push(`Android versionCode must be ${EXPECTED.versionCode}.`);
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
  if (command === 'manifest') {
    const contents = fs.readFileSync(argument, 'utf8');
    failOnErrors(validateAndroidManifest(contents));
    return;
  }
  throw new Error(
    'Usage: verify-android-preprod.js <metadata|manifest|apk> [file-path]',
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
  main,
  validateApkContents,
  validateAndroidManifest,
  validateMetadata,
  verifyApk,
};
