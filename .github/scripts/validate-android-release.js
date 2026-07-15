const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_ENV = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
  'ANDROID_CERT_SHA256',
  'RELEASES_TOKEN',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_OPENIM_API_URL',
  'EXPO_PUBLIC_OPENIM_WS_URL',
];

function validateUrl(errors, name, value, protocol) {
  if (!value) return;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== protocol || parsed.username || parsed.password) {
      errors.push(`${name} must use ${protocol} without embedded credentials.`);
    }
  } catch {
    errors.push(`${name} must be a valid ${protocol} URL.`);
  }
}

function expectedVersionCode(version) {
  const parts = version.split('.').map(Number);
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isInteger(part) || part < 0) ||
    parts[1] >= 1000 ||
    parts[2] >= 1000
  ) {
    return null;
  }

  return parts[0] * 1_000_000 + parts[1] * 1000 + parts[2];
}

function validateReleaseConfig({ env, app }) {
  const errors = [];

  for (const name of REQUIRED_ENV) {
    if (!env[name]?.trim()) errors.push(`${name} is required.`);
  }

  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(env.RELEASE_TAG ?? '');
  if (!match) {
    errors.push('RELEASE_TAG must be a stable semantic version such as v1.2.3.');
  } else {
    const tagVersion = match.slice(1).map(Number).join('.');
    if (tagVersion !== app.version) {
      errors.push(
        `RELEASE_TAG ${env.RELEASE_TAG} does not match app version ${app.version}.`,
      );
    }

    const expected = expectedVersionCode(tagVersion);
    if (expected === null || app.android?.versionCode !== expected) {
      errors.push(
        `android.versionCode must be ${expected ?? 'derived from the semantic version'} for version ${tagVersion}.`,
      );
    }
  }

  const fingerprint = (env.ANDROID_CERT_SHA256 ?? '').replaceAll(':', '');
  if (fingerprint && !/^[a-fA-F0-9]{64}$/.test(fingerprint)) {
    errors.push('ANDROID_CERT_SHA256 must be a SHA-256 certificate fingerprint.');
  }

  validateUrl(errors, 'EXPO_PUBLIC_API_URL', env.EXPO_PUBLIC_API_URL, 'https:');
  validateUrl(
    errors,
    'EXPO_PUBLIC_OPENIM_API_URL',
    env.EXPO_PUBLIC_OPENIM_API_URL,
    'https:',
  );
  validateUrl(
    errors,
    'EXPO_PUBLIC_OPENIM_WS_URL',
    env.EXPO_PUBLIC_OPENIM_WS_URL,
    'wss:',
  );

  return errors;
}

function main() {
  const app = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'),
  ).expo;
  const errors = validateReleaseConfig({ env: process.env, app });

  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { expectedVersionCode, validateReleaseConfig };
