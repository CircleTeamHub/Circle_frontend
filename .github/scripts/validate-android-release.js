const fs = require('node:fs');
const path = require('node:path');

const METADATA_ENV = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_OPENIM_API_URL',
  'EXPO_PUBLIC_OPENIM_WS_URL',
  'EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID',
];

// support-categories.ts 里每类客服（充值 / 纠纷 / 账号申诉 / 账号客服）的专属账号环境变量。
// 任一为空会回退到通用 EXPO_PUBLIC_SUPPORT_ACCOUNT_ID；后者也空时最终回退到系统管理账号
// imAdmin —— 把敏感客服会话路由到非客服的意外身份。发布须保证有兜底：见 validateSupportAccounts。
const CATEGORY_SUPPORT_ENV = [
  'EXPO_PUBLIC_SUPPORT_RECHARGE_ID',
  'EXPO_PUBLIC_SUPPORT_ISSUE_ID',
  'EXPO_PUBLIC_SUPPORT_DISPUTE_ID',
  'EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID',
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

// 客服路由必须有可信兜底：要么配了通用客服账号 EXPO_PUBLIC_SUPPORT_ACCOUNT_ID，要么四类
// 专属账号全配齐。两者都缺时，充值 / 纠纷 / 账号类客服会静默落到系统账号 imAdmin —— 绝不能
// 带着这种配置发正式包。
function validateSupportAccounts(errors, env) {
  if (env.EXPO_PUBLIC_SUPPORT_ACCOUNT_ID?.trim()) return;

  const missing = CATEGORY_SUPPORT_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    errors.push(
      `Support routing would fall back to the system account (imAdmin): set EXPO_PUBLIC_SUPPORT_ACCOUNT_ID, or all of ${CATEGORY_SUPPORT_ENV.join(
        ', ',
      )} (missing: ${missing.join(', ')}).`,
    );
  }
}

// 会被编译进 APK 的那组变量 —— 与 tag / 版本号无关，所以不需要 RELEASE_TAG 就能校验。
// 单独拆出来是为了让每日构建复用同一份合同：它转发的是同一组 repository variables，
// 却没有 tag。少了这道校验，删掉或写错一个变量只会让构建静默编译 imAdmin 回落分支，
// 而 assembleRelease 依然是绿的。
function validateBuildEnv({ env }) {
  const errors = [];

  requireValues(errors, env, METADATA_ENV);
  validateSupportAccounts(errors, env);
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

function validateReleaseMetadata({ env, app }) {
  const errors = validateBuildEnv({ env });

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
      // 每日构建用：只校验会编译进包的变量，不要求 RELEASE_TAG。
      case 'build-env':
        errors = validateBuildEnv({ env: process.env });
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
  validateBuildEnv,
  validateDistributionApproval,
  validateReleaseMetadata,
  validateSigningConfig,
  validateSupportAccounts,
};
