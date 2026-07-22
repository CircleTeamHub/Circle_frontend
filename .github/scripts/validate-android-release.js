const fs = require('node:fs');
const path = require('node:path');

const METADATA_ENV = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_OPENIM_API_URL',
  'EXPO_PUBLIC_OPENIM_WS_URL',
  'EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID',
];

const SIGNING_ENV = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
  'ANDROID_CERT_SHA256',
];

function requireValues(errors, env, names) {
  for (const name of names) {
    if (!env[name]?.trim()) errors.push(`${name} is required.`);
  }
}

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

function validateReleaseMetadata({ env, app }) {
  const errors = [];

  requireValues(errors, env, METADATA_ENV);

  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    env.RELEASE_TAG ?? '',
  );
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

function validateSigningConfig({ env }) {
  const errors = [];
  requireValues(errors, env, SIGNING_ENV);

  const fingerprint = env.ANDROID_CERT_SHA256 ?? '';
  if (
    fingerprint &&
    !/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(
      fingerprint,
    )
  ) {
    errors.push('ANDROID_CERT_SHA256 must be a SHA-256 certificate fingerprint.');
  }

  return errors;
}

function validateDistributionApproval({ env }) {
  const errors = [];

  for (const name of [
    'ANDROID_PUBLIC_RELEASE_ENABLED',
    'ANDROID_DISTRIBUTION_APPROVED',
  ]) {
    if (env[name] !== 'true') errors.push(`${name} must be true.`);
  }

  requireValues(errors, env, ['ANDROID_DISTRIBUTION_EVIDENCE_URL']);
  validateUrl(
    errors,
    'ANDROID_DISTRIBUTION_EVIDENCE_URL',
    env.ANDROID_DISTRIBUTION_EVIDENCE_URL,
    'https:',
  );

  return errors;
}

function readApp() {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'),
  ).expo;
}

function validateLegacyReleaseConfig({ env, app }) {
  const errors = [
    ...validateReleaseMetadata({ env, app }),
    ...validateSigningConfig({ env }),
  ];
  requireValues(errors, env, ['RELEASES_TOKEN']);
  return errors;
}

function main() {
  const scope = process.argv[2];
  let errors;

  try {
    switch (scope) {
      case undefined:
        errors = validateLegacyReleaseConfig({
          env: process.env,
          app: readApp(),
        });
        break;
      case 'metadata':
        errors = validateReleaseMetadata({ env: process.env, app: readApp() });
        break;
      case 'signing':
        errors = validateSigningConfig({ env: process.env });
        break;
      case 'distribution':
        errors = validateDistributionApproval({ env: process.env });
        break;
      case 'all':
        errors = [
          ...validateReleaseMetadata({ env: process.env, app: readApp() }),
          ...validateSigningConfig({ env: process.env }),
          ...validateDistributionApproval({ env: process.env }),
        ];
        break;
      default:
        errors = [`Unknown validation scope: ${scope}`];
    }
  } catch (error) {
    errors = [error.message];
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  expectedVersionCode,
  validateDistributionApproval,
  validateReleaseMetadata,
  validateSigningConfig,
};
