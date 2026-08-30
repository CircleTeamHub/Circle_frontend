const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED = Object.freeze({
  version: '1.0.1',
  versionCode: 1000001,
  packageName: 'com.yiboding.circleim',
  apiUrl: 'https://api-43-133-201-42.sslip.io',
  apiHost: 'api-43-133-201-42.sslip.io',
  mediaOrigin:
    'https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
  mediaHost: 'windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
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
  if (!isExactHttpsUrl(env.EXPO_PUBLIC_API_URL, EXPECTED.apiUrl)) {
    errors.push(`EXPO_PUBLIC_API_URL must be ${EXPECTED.apiUrl}.`);
  }
  if (!isExactHttpsUrl(env.EXPO_PUBLIC_CHAT_WS_URL, EXPECTED.apiUrl)) {
    errors.push(`EXPO_PUBLIC_CHAT_WS_URL must be ${EXPECTED.apiUrl}.`);
  }
  if (!isExactHttpsUrl(env.EXPO_PUBLIC_MEDIA_ORIGINS, EXPECTED.mediaOrigin)) {
    errors.push(`EXPO_PUBLIC_MEDIA_ORIGINS must be ${EXPECTED.mediaOrigin}.`);
  }
  return errors;
}

function validateApkContents(contents) {
  const haystack = contents.toString('latin1').toLowerCase();
  const errors = [];
  for (const [label, expected] of [
    ['API host', EXPECTED.apiHost],
    ['media host', EXPECTED.mediaHost],
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
    const app = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'),
    ).expo;
    failOnErrors(validateMetadata({ app, env: process.env }));
    return;
  }
  if (command === 'apk') {
    verifyApk(argument);
    return;
  }
  throw new Error('Usage: verify-android-preprod.js <metadata|apk> [apk-path]');
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
  validateMetadata,
  verifyApk,
};
