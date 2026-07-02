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

function loadServerErrorCodes() {
  const filePath = path.join(process.cwd(), 'src/services/api/server-error-codes.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', transpiled);
  fn(moduleObj, moduleObj.exports, require);
  return moduleObj.exports;
}

const BACKEND_CODES_PATH = path.join(
  process.cwd(),
  '..',
  'circle_be',
  'src/common/app-error-codes.ts',
);

function loadBackendErrorCodes() {
  const filePath = BACKEND_CODES_PATH;
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', transpiled);
  fn(moduleObj, moduleObj.exports, require);
  return moduleObj.exports;
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
    if (spec === '@/services/api/server-error-codes') return loadServerErrorCodes();
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

test('uses the caller fallback when the errorCode is unknown', () => {
  const err = new FakeApiError('后端原始消息', 'AUTH_SOMETHING_NEW');
  assert.equal(getApiErrorMessage(err, 'fallback'), 'fallback');
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
  const clientPath = path.join(process.cwd(), 'src/services/api/client.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(clientPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: clientPath,
  }).outputText;
  const moduleObj = { exports: {} };
  const shimRequire = (spec) => {
    if (spec === '@/constants/config') return { API_URL: 'http://example.test' };
    if (spec === '@/services/auth/session') return { clearLocalSession: async () => {} };
    if (spec === '@/stores/authStore') {
      return {
        useAuthStore: {
          getState: () => ({ accessToken: null, refreshToken: null, setTokens: () => {} }),
        },
      };
    }
    if (spec === '@/observability/sentry') {
      return {
        reportError: () => {},
        shouldReportHttpFailure: () => false,
      };
    }
    if (spec === '@/i18n') return I18N;
    return require(spec);
  };
  const fn = new Function(
    'module',
    'exports',
    'require',
    'fetch',
    'AbortController',
    'setTimeout',
    'clearTimeout',
    transpiled,
  );
  fn(
    moduleObj,
    moduleObj.exports,
    shimRequire,
    async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          code: 1,
          message: 'backend message',
          errorCode: 'AUTH_INVALID_CREDENTIALS',
          data: null,
        }),
    }),
    AbortController,
    setTimeout,
    clearTimeout,
  );

  return assert.rejects(
    () => moduleObj.exports.apiClient('/auth/login', { auth: false }),
    (err) =>
      err instanceof moduleObj.exports.ApiError &&
      err.status === 400 &&
      err.errorCode === 'AUTH_INVALID_CREDENTIALS',
  );
});

test('ApiError accepts an options object for optional fields', () => {
  const clientPath = path.join(process.cwd(), 'src/services/api/client.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(clientPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: clientPath,
  }).outputText;
  const moduleObj = { exports: {} };
  const shimRequire = (spec) => {
    if (spec === '@/constants/config') return { API_URL: 'http://example.test' };
    if (spec === '@/services/auth/session') return { clearLocalSession: async () => {} };
    if (spec === '@/stores/authStore') {
      return {
        useAuthStore: {
          getState: () => ({ accessToken: null, refreshToken: null, setTokens: () => {} }),
        },
      };
    }
    if (spec === '@/observability/sentry') {
      return {
        reportError: () => {},
        shouldReportHttpFailure: () => false,
      };
    }
    if (spec === '@/i18n') return I18N;
    return require(spec);
  };
  const fn = new Function(
    'module',
    'exports',
    'require',
    'fetch',
    'AbortController',
    'setTimeout',
    'clearTimeout',
    transpiled,
  );
  fn(
    moduleObj,
    moduleObj.exports,
    shimRequire,
    async () => {
      throw new Error('fetch should not be called');
    },
    AbortController,
    setTimeout,
    clearTimeout,
  );

  const err = new moduleObj.exports.ApiError('message', {
    status: 409,
    code: 1001,
    data: { field: 'email' },
    failureKind: 'api-code',
    reportEndpoint: '/auth/register',
    reportMethod: 'POST',
    errorCode: 'AUTH_EMAIL_TAKEN',
  });

  assert.equal(err.status, 409);
  assert.equal(err.code, 1001);
  assert.deepEqual(err.data, { field: 'email' });
  assert.equal(err.failureKind, 'api-code');
  assert.equal(err.reportEndpoint, '/auth/register');
  assert.equal(err.reportMethod, 'POST');
  assert.equal(err.errorCode, 'AUTH_EMAIL_TAKEN');
});

test('every locale defines all serverErrors codes', () => {
  const contractCodes = [...loadServerErrorCodes().SERVER_ERROR_CODES].sort();

  const readBundle = (lng) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/i18n/locales/${lng}.json`), 'utf8'));
  const expectedCodes = Object.keys(readBundle('en').serverErrors ?? {}).sort();
  assert.ok(expectedCodes.length > 0, 'en.json must define serverErrors');
  assert.deepEqual(expectedCodes, contractCodes, 'en.json serverErrors keys must match SERVER_ERROR_CODES');

  for (const lng of ['zh', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), `src/i18n/locales/${lng}.json`), 'utf8'),
    );
    assert.deepEqual(
      Object.keys(bundle.serverErrors ?? {}).sort(),
      expectedCodes,
      `${lng}.json serverErrors keys must match en.json`,
    );
  }
});

// Cross-repo contract: the frontend whitelist must equal the backend catalog. Only
// runs when circle_be is checked out beside circle-im (local dev / combined CI);
// frontend-only CI has no sibling repo, so skip instead of ENOENT-failing the suite.
test(
  'frontend SERVER_ERROR_CODES matches the backend APP_ERROR_CODES',
  { skip: !fs.existsSync(BACKEND_CODES_PATH) },
  () => {
    const contractCodes = [...loadServerErrorCodes().SERVER_ERROR_CODES].sort();
    const backendCodes = [...loadBackendErrorCodes().APP_ERROR_CODES].sort();
    assert.deepEqual(
      contractCodes,
      backendCodes,
      'frontend SERVER_ERROR_CODES must match backend APP_ERROR_CODES',
    );
  },
);
