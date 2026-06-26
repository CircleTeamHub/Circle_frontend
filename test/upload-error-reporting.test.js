const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadUpload({
  ok = false,
  status = 500,
  onReport = () => {},
  fetchError,
} = {}) {
  const filePath = path.join(process.cwd(), 'src/services/api/upload.ts');
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
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      if (fetchError) throw fetchError;
      return { ok, status };
    },
    console: { log: () => {} },
    require: (request) => {
      switch (request) {
        case '@/services/api/client':
          return { apiClient: async () => ({}) };
        case 'react-native':
          return { Platform: { OS: 'web' } };
        case 'expo-file-system/legacy':
          return {
            uploadAsync: async () => ({}),
            FileSystemUploadType: { BINARY_CONTENT: 'binary' },
          };
        case '@/utils/validate':
          return {
            expectShape: (v) => v,
            isNonEmptyString: () => true,
            isPlainObject: () => true,
          };
        case '@/observability/sentry':
          return { reportError: onReport };
        default:
          return require(request);
      }
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('uploadFileToPresignedUrl reports a failed upload without leaking the signed URL', async () => {
  const reports = [];
  const { uploadFileToPresignedUrl } = loadUpload({
    ok: false,
    status: 500,
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() =>
    uploadFileToPresignedUrl(
      'https://store/obj?X-Amz-Signature=secret',
      'image/png',
      {},
    ),
  );

  assert.equal(reports.length, 1);
  assert.equal(reports[0].operation, 'upload');
  assert.equal(reports[0].kind, 'presigned-put');
  assert.equal(reports[0].contentType, 'image/png');
  // The signed upload URL must never appear in the reported context.
  assert.doesNotMatch(JSON.stringify(reports[0]), /X-Amz-Signature|store\/obj/);
});

test('uploadFileToPresignedUrl reports 4xx upload failures too (unlike the API path)', async () => {
  const reports = [];
  const { uploadFileToPresignedUrl } = loadUpload({
    ok: false,
    status: 403,
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() =>
    uploadFileToPresignedUrl('https://store/x', 'image/png', {}),
  );

  assert.equal(reports.length, 1);
});

test('uploadFileToPresignedUrl does not report a successful upload', async () => {
  const reports = [];
  const { uploadFileToPresignedUrl } = loadUpload({
    ok: true,
    status: 200,
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await uploadFileToPresignedUrl('https://store/x', 'image/png', {});

  assert.equal(reports.length, 0);
});

test('uploadFileToPresignedUrl reports a sanitized error when native errors include signed URLs', async () => {
  const reports = [];
  const { uploadFileToPresignedUrl } = loadUpload({
    fetchError: new Error('PUT failed https://store/obj?X-Amz-Signature=secret'),
    onReport: (err, ctx) => reports.push([err, ctx]),
  });

  await assert.rejects(() =>
    uploadFileToPresignedUrl(
      'https://store/obj?X-Amz-Signature=secret',
      'image/png',
      {},
    ),
  );

  assert.equal(reports.length, 1);
  assert.match(reports[0][0].message, /\[REDACTED_URL\]/);
  assert.doesNotMatch(JSON.stringify(reports), /X-Amz-Signature|store\/obj/);
});
