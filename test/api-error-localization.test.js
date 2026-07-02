const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// getApiErrorMessage turns a backend stable errorCode into a localized string
// (serverErrors.<code>), falling back to the backend message, then the caller's
// fallback. Backend attaches the code via `throw new X({ message, errorCode })`
// and all-exception.filter surfaces it; client.ts threads it onto ApiError.

// Fake i18n whose t() knows one serverErrors key and otherwise echoes defaultValue.
const I18N = {
  __esModule: true,
  default: {
    language: 'en',
    t: (key, opts) => {
      const table = { 'serverErrors.AUTH_INVALID_CREDENTIALS': 'Incorrect email or password' };
      if (table[key]) return table[key];
      return opts && 'defaultValue' in opts ? opts.defaultValue : key;
    },
  },
};

// Fake ApiError — errors.ts uses `instanceof ApiError`, so tests must build errors
// from this same class for the check to hold.
class FakeApiError extends Error {
  constructor(message, errorCode) {
    super(message);
    this.name = 'ApiError';
    this.errorCode = errorCode;
  }
}

function loadErrors() {
  const filePath = path.join(process.cwd(), 'src/services/api/errors.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const moduleObj = { exports: {} };
  const shimRequire = (spec) => {
    if (spec === '@/i18n') return I18N;
    if (spec === '@/services/api/client') return { ApiError: FakeApiError };
    return require(spec);
  };
  // new Function runs in the host realm, so `error instanceof Error` inside errors.ts
  // matches errors built here (vm.runInNewContext would give it a separate Error realm).
  const fn = new Function('module', 'exports', 'require', transpiled);
  fn(moduleObj, moduleObj.exports, shimRequire);
  return moduleObj.exports;
}

const { getApiErrorMessage } = loadErrors();

test('maps a known errorCode to its localized serverErrors string', () => {
  const err = new FakeApiError('邮箱或密码错误', 'AUTH_INVALID_CREDENTIALS');
  assert.equal(getApiErrorMessage(err, 'fallback'), 'Incorrect email or password');
});

test('falls back to the backend message when the errorCode has no locale key', () => {
  const err = new FakeApiError('后端原始消息', 'AUTH_SOMETHING_NEW');
  assert.equal(getApiErrorMessage(err, 'fallback'), '后端原始消息');
});

test('uses the backend message when there is no errorCode', () => {
  const err = new FakeApiError('请求失败', undefined);
  assert.equal(getApiErrorMessage(err, 'fallback'), '请求失败');
});

test('non-ApiError falls through to Error.message, then the fallback', () => {
  assert.equal(getApiErrorMessage(new Error('boom'), 'fallback'), 'boom');
  assert.equal(getApiErrorMessage('weird', 'fallback'), 'fallback');
});

test('client.ts threads errorCode onto ApiError', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/services/api/client.ts'), 'utf8');
  assert.match(src, /errorCode\?: string/); // ApiResponse + ApiError field
  assert.match(src, /this\.errorCode = errorCode/); // constructor stores it
  assert.match(src, /\)\?\.errorCode/); // unwrapResponse reads it off the payload
});

test('every locale defines all serverErrors codes', () => {
  const CODES = [
    'AUTH_INVALID_CREDENTIALS',
    'AUTH_EMAIL_TAKEN',
    'AUTH_CODE_INVALID',
    'AUTH_ACCOUNT_ID_TAKEN',
    'AUTH_SECURITY_CODE_INVALID',
    'AUTH_SECURITY_CODE_LOCKED',
    'COIN_SELF_TRANSFER',
    'COIN_NOT_FRIEND',
    'COIN_INSUFFICIENT',
    'COIN_AMOUNT_INVALID',
    'MEMBERSHIP_INVALID_LEVEL',
    'MEMBERSHIP_LEVEL_NOT_HIGHER',
    'MEMBERSHIP_INSUFFICIENT_POINTS',
    'CIRCLE_MEMBER_LIMIT',
    'CIRCLE_ALREADY_MEMBER',
    'CIRCLE_REQUEST_PENDING',
    'GROUP_MANAGER_ONLY',
    'GROUP_OWNER_CANNOT_LEAVE',
    'GROUP_INVITE_NOT_ALLOWED',
    'GROUP_REPORT_NOT_VERIFIED',
    'GROUP_REPORT_NOT_ACTIVE',
    'GROUP_REPORT_DUPLICATE',
    'GROUP_REPORT_DESC_EMPTY',
  ];
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), `src/i18n/locales/${lng}.json`), 'utf8'),
    );
    for (const code of CODES) {
      assert.ok(bundle.serverErrors?.[code], `${lng}.json missing serverErrors.${code}`);
    }
  }
});
