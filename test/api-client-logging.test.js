const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApiClient({ responseText, logs }) {
  const filePath = path.join(process.cwd(), 'src/services/api/client.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    __DEV__: true,
    AbortController,
    ArrayBuffer,
    Blob,
    FormData,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    fetch: async () => ({
      ok: true,
      status: 201,
      text: async () => responseText,
    }),
    console: {
      log: (...args) => logs.push(args),
    },
    require: (request) => {
      if (request === '@/constants/config') {
        return { API_URL: 'http://192.168.1.65:3000/api/v1' };
      }
      if (request === '@/services/auth/session') {
        return { clearLocalSession: async () => {} };
      }
      if (request === '@/stores/authStore') {
        return {
          useAuthStore: {
            getState: () => ({
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              setTokens: () => {},
            }),
          },
        };
      }
      return require(request);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('api dev logs redact presigned upload URLs and object keys', async () => {
  const logs = [];
  const { apiClient } = loadApiClient({
    logs,
    responseText: JSON.stringify({
      code: 0,
      message: 'ok',
      data: {
        uploadUrl:
          'http://192.168.1.65:9000/circle/chat/user/file.heic?X-Amz-Signature=secret',
        fileUrl: 'http://192.168.1.65:9000/circle/chat/user/file.heic',
        key: 'chat/user/file.heic',
      },
    }),
  });

  await apiClient('/upload/presign', {
    method: 'POST',
    body: {
      filename: 'file.heic',
      contentType: 'image/heic',
      folder: 'chat',
    },
  });

  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /X-Amz-Signature/);
  assert.doesNotMatch(serializedLogs, /circle\/chat\/user\/file\.heic/);
  assert.match(serializedLogs, /\[REDACTED/);
});
