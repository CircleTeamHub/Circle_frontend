const fs = require('node:fs');
const path = require('node:path');

const METADATA_ENV = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_MEDIA_ORIGINS'];

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

function validateOriginList(errors, name, value) {
  if (!value) return;

  for (const candidate of value.split(',')) {
    const origin = candidate.trim();
    if (!origin) {
      errors.push(`${name} must be a comma-separated list of HTTPS origins.`);
      continue;
    }

    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      errors.push(`${name} contains an invalid HTTPS origin.`);
      continue;
    }

    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      errors.push(
        `${name} entries must be HTTPS origins without credentials, paths, queries, or fragments.`,
      );
    }
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

// Sentry DSN 是「软要求」，与上面这些不同：src/observability/sentry.ts 在没有 DSN 时
// 整体 no-op，app 功能完全正常，所以缺它不该 fail 构建。但「release 包完全没有崩溃上报」
// 是个安静到没人会发现的状态——偶发卡死 / ANR 事后全靠它定位，而构建依旧全绿。故缺失时
// 每次构建都出一条 ::warning::。
//
// 反过来，DSN 配了但格式不对必须 fail：Sentry.init 会静默抛错被 catch 掉（sentry.ts
// 的 try/catch），结果和没配一模一样，却让人误以为上报已经接好——比缺失更危险。
function validateSentryDsn(errors, env) {
  const dsn = env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;

  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    errors.push(
      'EXPO_PUBLIC_SENTRY_DSN must be a Sentry DSN URL such as https://<publicKey>@<host>/<projectId>.',
    );
    return;
  }

  if (parsed.protocol !== 'https:') {
    errors.push('EXPO_PUBLIC_SENTRY_DSN must use https.');
  }
  if (!parsed.username) {
    errors.push(
      'EXPO_PUBLIC_SENTRY_DSN is missing its public key (expected https://<publicKey>@<host>/<projectId>).',
    );
  }
  // DSN 的 secret key 段在 2016 年就废弃了。它出现通常意味着贴进来的是一份旧的、
  // 或者是本不该进客户端包的凭证——客户端 DSN 会随 APK 分发给所有人。
  if (parsed.password) {
    errors.push(
      'EXPO_PUBLIC_SENTRY_DSN must not contain a secret key — client DSNs ship inside the APK.',
    );
  }
  if (!/\/\d+$/.test(parsed.pathname)) {
    errors.push(
      'EXPO_PUBLIC_SENTRY_DSN must end with a numeric project id (e.g. https://<publicKey>@<host>/4507).',
    );
  }
}

function collectBuildEnvWarnings({ env }) {
  const warnings = [];
  if (!env.EXPO_PUBLIC_SENTRY_DSN?.trim()) {
    warnings.push(
      'EXPO_PUBLIC_SENTRY_DSN is not set — this build ships with Sentry dormant, so crashes, ANRs and handled errors are reported nowhere. Set the repository variable to enable crash reporting.',
    );
  }
  return warnings;
}

// 「发布就绪」类缺口：变量压根没配。带着它发正式包是事故（客服会话落到 imAdmin），
// 但它跟「这份代码还能不能编译成 release 包」毫无关系 —— 每日构建签的是一次性密钥、
// 产物按设计永不分发，对它而言这些值缺失是无害的。故按调用方分级：
// tag 路径当错误（validateBuildEnv），每日路径当告警（build-env scope）。
function collectReleaseConfigGaps({ env }) {
  const gaps = [];

  requireValues(gaps, env, METADATA_ENV);

  return gaps;
}

// 「值写坏了」类错误：任何路径都必须硬失败。没配和配错是两回事 —— 配错证明有人改错了
// 变量，正是每日构建最初要抓的漂移，而且这些形态问题在 tag 那天同样拦不住。
function validateBuildEnvShape({ env }) {
  const errors = [];

  validateUrl(errors, 'EXPO_PUBLIC_API_URL', env.EXPO_PUBLIC_API_URL, 'https:');
  validateOriginList(
    errors,
    'EXPO_PUBLIC_MEDIA_ORIGINS',
    env.EXPO_PUBLIC_MEDIA_ORIGINS,
  );
  validateSentryDsn(errors, env);

  return errors;
}

// 会被编译进 APK 的那组变量 —— 与 tag / 版本号无关，所以不需要 RELEASE_TAG 就能校验。
// 这是发布路径（metadata scope）的完整合同：缺口 + 形态问题全部是错误。
function validateBuildEnv({ env }) {
  return [...collectReleaseConfigGaps({ env }), ...validateBuildEnvShape({ env })];
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

function validateSentryUploadConfig({ env }) {
  const errors = [];
  requireValues(errors, env, [
    'EXPO_PUBLIC_SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'SENTRY_RELEASE',
    'EXPO_PUBLIC_SENTRY_RELEASE',
    'SENTRY_DIST',
    'EXPO_PUBLIC_SENTRY_DIST',
    'RELEASE_TAG',
    'ANDROID_VERSION_CODE',
  ]);
  validateSentryDsn(errors, env);

  if (
    env.SENTRY_RELEASE?.trim() &&
    env.EXPO_PUBLIC_SENTRY_RELEASE?.trim() &&
    env.SENTRY_RELEASE.trim() !== env.EXPO_PUBLIC_SENTRY_RELEASE.trim()
  ) {
    errors.push('SENTRY_RELEASE must equal EXPO_PUBLIC_SENTRY_RELEASE.');
  }
  if (
    env.SENTRY_DIST?.trim() &&
    env.EXPO_PUBLIC_SENTRY_DIST?.trim() &&
    env.SENTRY_DIST.trim() !== env.EXPO_PUBLIC_SENTRY_DIST.trim()
  ) {
    errors.push('SENTRY_DIST must equal EXPO_PUBLIC_SENTRY_DIST.');
  }

  const expectedRelease = env.RELEASE_TAG?.trim()
    ? `windnote@${env.RELEASE_TAG.trim()}`
    : undefined;
  if (
    expectedRelease &&
    env.SENTRY_RELEASE?.trim() &&
    env.SENTRY_RELEASE.trim() !== expectedRelease
  ) {
    errors.push(`SENTRY_RELEASE must be ${expectedRelease}.`);
  }
  if (
    env.ANDROID_VERSION_CODE?.trim() &&
    env.SENTRY_DIST?.trim() &&
    env.SENTRY_DIST.trim() !== env.ANDROID_VERSION_CODE.trim()
  ) {
    errors.push('SENTRY_DIST must equal ANDROID_VERSION_CODE.');
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

// 哪些 scope 会编译出一个真正的包 —— 只有这些需要提醒「这个包没有崩溃上报」。
// signing / distribution 只读凭证与审批位，跟包内可观测性无关。
const BUILD_ENV_SCOPES = new Set([undefined, 'metadata', 'build-env', 'all']);

// 降级成告警之后，缺口在 40 分钟的构建日志里等同于不存在。所以除了 ::warning::
// 还要写进 job summary —— 每日构建绿了，但页面顶部仍然列着「这些变量没配，现在
// 还不能打 tag」。少了这一步，「降级」在实践中就是「删掉这条检查」。
function reportReleaseConfigGaps({ env }) {
  const gaps = collectReleaseConfigGaps({ env });
  if (gaps.length === 0) return;

  for (const gap of gaps) console.warn(`::warning::${gap}`);

  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  fs.appendFileSync(
    summaryPath,
    [
      '### ⚠️ 发布配置缺口（每日构建不因此失败）',
      '',
      '以下变量缺失。每日构建产物永不分发，所以照常编译；但**打 `v*` tag 会因同样的检查硬失败**：',
      '',
      ...gaps.map((gap) => `- ${gap}`),
      '',
    ].join('\n'),
  );
}

function main() {
  const scope = process.argv[2];
  let errors;

  if (BUILD_ENV_SCOPES.has(scope)) {
    for (const warning of collectBuildEnvWarnings({ env: process.env })) {
      console.warn(`::warning::${warning}`);
    }
  }

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
      // 缺口降级为告警 —— 否则一个没配的变量会让 assembleRelease / R8 / 打包
      // 这几步永远跑不到，而它们才是每日构建唯一要守的东西。
      case 'build-env':
        reportReleaseConfigGaps({ env: process.env });
        errors = validateBuildEnvShape({ env: process.env });
        break;
      case 'signing':
        errors = validateSigningConfig({ env: process.env });
        break;
      case 'sentry-upload':
        errors = validateSentryUploadConfig({ env: process.env });
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
  collectBuildEnvWarnings,
  collectReleaseConfigGaps,
  expectedVersionCode,
  validateBuildEnv,
  validateBuildEnvShape,
  validateDistributionApproval,
  validateReleaseMetadata,
  validateSigningConfig,
  validateSentryUploadConfig,
};
