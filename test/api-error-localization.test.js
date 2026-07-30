const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

// getApiErrorMessage turns a backend stable errorCode into a localized string
// (serverErrors.<code>), falling back to the caller's fallback. Backend attaches
// the code via `throw new X({ message, errorCode })`
// and all-exception.filter surfaces it; client.ts threads it onto ApiError.

// Fake i18n whose t() knows one serverErrors key and otherwise echoes defaultValue.
const I18N = {
  __esModule: true,
  default: {
    language: 'en',
    t: (key, opts) => {
      const table = {
        'serverErrors.AUTH_INVALID_CREDENTIALS': 'Incorrect email or password',
        'serverErrors.TRACE_EMPTY_COMMENT': 'Comment cannot be empty',
      };
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

const BACKEND_CODES_PATH =
  process.env.BACKEND_CODES_PATH ||
  path.join(process.cwd(), '..', 'circle_be', 'src/common/app-error-codes.ts');
const REQUIRE_BACKEND_ERROR_CODES =
  process.env.REQUIRE_BACKEND_ERROR_CODES === '1';

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

test('maps the empty-comment backend code to localized copy', () => {
  const err = new FakeApiError('评论内容不能为空', 'TRACE_EMPTY_COMMENT');
  assert.equal(getApiErrorMessage(err, 'fallback'), 'Comment cannot be empty');
});

test('uses the caller fallback when the errorCode is unknown', () => {
  const err = new FakeApiError('后端原始消息', 'AUTH_SOMETHING_NEW');
  assert.equal(getApiErrorMessage(err, 'fallback'), 'fallback');
});

test('uses the caller fallback when ApiError has no errorCode', () => {
  const err = new FakeApiError('请求失败', undefined);
  assert.equal(getApiErrorMessage(err, 'fallback'), 'fallback');
});

test('non-ApiError falls through to Error.message, then the fallback', () => {
  assert.equal(getApiErrorMessage(new Error('boom'), 'fallback'), 'boom');
  assert.equal(getApiErrorMessage('weird', 'fallback'), 'fallback');
});

test('avatar-frame response diagnostics are never exposed to users', () => {
  const error = new Error(
    'Malformed /avatar-frames/me response: equippedFrameId is inconsistent',
  );
  error.name = 'AvatarFrameResponseValidationError';

  assert.equal(getApiErrorMessage(error, 'fallback'), 'fallback');
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
    if (spec === '@/services/auth/session') {
      return {
        clearLocalSession: async () => {},
        registerLogoutHandler: () => () => {},
      };
    }
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
    if (spec === '@/utils/redact') return loadTsModule('src/utils/redact.ts');
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
    if (spec === '@/services/auth/session') {
      return {
        clearLocalSession: async () => {},
        registerLogoutHandler: () => () => {},
      };
    }
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
    if (spec === '@/utils/redact') return loadTsModule('src/utils/redact.ts');
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

test('joined-circle hard limit uses the stable backend contract in every locale', () => {
  const { SERVER_ERROR_CODES } = loadServerErrorCodes();
  assert.ok(SERVER_ERROR_CODES.includes('CIRCLE_JOIN_LIMIT_REACHED'));

  const expectedChinese = '最多可加入 100 个圈子，请先退出其他圈子后再试';
  for (const lng of ['en', 'zh', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${lng}.json`),
        'utf8',
      ),
    );
    assert.equal(
      typeof bundle.serverErrors.CIRCLE_JOIN_LIMIT_REACHED,
      'string',
    );
    assert.ok(
      bundle.serverErrors.CIRCLE_JOIN_LIMIT_REACHED.trim().length > 0,
    );
  }
  const zhBundle = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'src/i18n/locales/zh.json'),
      'utf8',
    ),
  );
  assert.equal(
    zhBundle.serverErrors.CIRCLE_JOIN_LIMIT_REACHED,
    expectedChinese,
  );
});

test('empty moment comments use the backend error contract in every locale', () => {
  const { SERVER_ERROR_CODES } = loadServerErrorCodes();
  assert.ok(SERVER_ERROR_CODES.includes('TRACE_EMPTY_COMMENT'));

  for (const lng of ['en', 'zh', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${lng}.json`),
        'utf8',
      ),
    );
    assert.equal(typeof bundle.serverErrors.TRACE_EMPTY_COMMENT, 'string');
    assert.ok(bundle.serverErrors.TRACE_EMPTY_COMMENT.trim().length > 0);
  }
});

// 回归：会员分支曾误删这几个与 VIP 无关的既有 code（及其全部译文），导致 temp-chat / note /
// upload / collection 流收到这些响应时 getApiErrorMessage 落回泛化 fallback、丢掉可操作的
// 本地化原因。这些必须始终留在白名单且五语齐全（#131 review）。
test('retains temp-chat / note / upload / collection error codes with full localization', () => {
  const { SERVER_ERROR_CODES } = loadServerErrorCodes();
  const RESTORED = [
    'TEMP_CHAT_JOIN_FAILED',
    'NOTE_RESTORE_DUPLICATE',
    'NOTE_SHARE_LINK_LIMIT',
    'UPLOAD_PAYLOAD_TOO_LARGE',
    'COLLECTION_LIMIT',
  ];
  for (const code of RESTORED) {
    assert.ok(
      SERVER_ERROR_CODES.includes(code),
      `SERVER_ERROR_CODES must include ${code}`,
    );
  }
  for (const lng of ['en', 'zh', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${lng}.json`),
        'utf8',
      ),
    );
    for (const code of RESTORED) {
      assert.equal(
        typeof bundle.serverErrors[code],
        'string',
        `${lng}.json serverErrors.${code} must be localized`,
      );
      assert.ok(bundle.serverErrors[code].trim().length > 0);
    }
  }
});

// Cross-repo contract: the frontend whitelist must equal the backend catalog. Only
// runs when circle_be is checked out beside circle-im (local dev / combined CI);
// frontend-only CI has no sibling repo, so skip instead of ENOENT-failing the suite.
test(
  'frontend SERVER_ERROR_CODES matches the backend APP_ERROR_CODES',
  {
    skip:
      !REQUIRE_BACKEND_ERROR_CODES && !fs.existsSync(BACKEND_CODES_PATH),
  },
  () => {
    assert.ok(
      fs.existsSync(BACKEND_CODES_PATH),
      `backend APP_ERROR_CODES file must exist at ${BACKEND_CODES_PATH}`,
    );
    const contractCodes = [...loadServerErrorCodes().SERVER_ERROR_CODES].sort();
    const backendCodes = [...loadBackendErrorCodes().APP_ERROR_CODES].sort();
    assert.deepEqual(
      contractCodes,
      backendCodes,
      'frontend SERVER_ERROR_CODES must match backend APP_ERROR_CODES',
    );
  },
);
