const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadUploadApi() {
  const filePath = path.join(process.cwd(), 'src/services/api/upload.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  let rnfsUploadCalled = false;
  let stoppedUploadJobId = null;
  let rnfsShouldHang = false;

  const context = {
    module: { exports: {} },
    exports: {},
    URL,
    setTimeout,
    clearTimeout,
    require: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: (...args) => ({
            uploadUrl:
              'http://localhost:9000/circle/avatars/test.jpeg?signature=123',
            fileUrl: 'http://localhost:9000/circle/avatars/test.jpeg',
            key: 'avatars/test.jpeg',
            mocked: true,
            args,
          }),
        };
      }
      if (request === '@/constants/config') {
        return {
          API_URL: 'http://10.0.0.195:3000/api/v1',
        };
      }
      if (request === '@/utils/validate') {
        return {
          isPlainObject: (v) =>
            typeof v === 'object' && v !== null && !Array.isArray(v),
          isNonEmptyString: (v) => typeof v === 'string' && v.length > 0,
          expectShape: (value, predicate, message) => {
            if (!predicate(value)) {
              throw new Error(message);
            }
            return value;
          },
        };
      }
      if (request === '@/observability/sentry') {
        return { reportError: () => {} };
      }
      if (request === 'react-native') {
        return {
          Platform: {
            OS: 'android',
          },
        };
      }
      if (request === 'expo-file-system/legacy') {
        return {
          FileSystemUploadType: {
            BINARY_CONTENT: 0,
          },
          uploadAsync: async (...args) => ({
            status: 200,
            headers: {},
            mimeType: null,
            body: '',
            mockedUploadArgs: args,
          }),
        };
      }
      if (request === 'react-native-fs') {
        return {
          __esModule: true,
          default: {
            uploadFiles: (options) => {
              rnfsUploadCalled = true;
              if (rnfsShouldHang) {
                return { jobId: 7, promise: new Promise(() => {}) };
              }
              return {
                jobId: 7,
                promise: Promise.resolve({
                  statusCode: 200,
                  headers: {},
                  body: '',
                  mockedUploadOptions: options,
                }),
              };
            },
            stopUpload: (jobId) => {
              stoppedUploadJobId = jobId;
            },
          },
        };
      }
      if (request === '@/i18n') {
        return {
          __esModule: true,
          default: {
            t: (key, opts) => { let s = (opts && opts.defaultValue) || key; if (opts) for (const k of Object.keys(opts)) if (k !== 'defaultValue') s = s.split('{{' + k + '}}').join(String(opts[k])); return s; },
            language: 'zh',
          },
        };
      }
      return require(request);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  context.module.exports.__getRnfsUploadCalled = () => rnfsUploadCalled;
  context.module.exports.__setRnfsShouldHang = (value) => {
    rnfsShouldHang = value;
  };
  context.module.exports.__getStoppedUploadJobId = () => stoppedUploadJobId;
  return context.module.exports;
}

test('upload helpers sanitize filenames and infer supported content types', () => {
  const { sanitizeUploadFilename, resolveUploadContentType } = loadUploadApi();

  assert.equal(
    sanitizeUploadFilename('my avatar(1).png'),
    'my-avatar-1-.png',
  );
  assert.equal(
    resolveUploadContentType({ mimeType: 'image/png', fileName: 'a.png' }),
    'image/png',
  );
  assert.equal(
    resolveUploadContentType({ mimeType: null, fileName: 'avatar.webp' }),
    'image/webp',
  );
});

test('upload.ts keeps react-native-fs available for cancellable Android local uploads', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/upload.ts'),
    'utf8',
  );

  assert.match(source, /react-native-fs/);
  assert.match(source, /stopUpload/);
});

test('android rejects localhost presigned upload urls instead of rewriting the signed host', async () => {
  const { requestUploadPresign } = loadUploadApi();

  await assert.rejects(
    () =>
      requestUploadPresign({
        filename: 'avatar.jpeg',
        contentType: 'image/jpeg',
        folder: 'avatars',
      }),
    /localhost.*403/,
  );
});

test('android local file upload preserves the presigned host and delegates to cancellable RNFS upload', async () => {
  const { uploadLocalFileToPresignedUrl, __getRnfsUploadCalled } = loadUploadApi();

  const response = await uploadLocalFileToPresignedUrl(
    'http://10.0.0.195:9000/circle/avatars/test.jpeg?signature=123',
    'image/jpeg',
    'file:///data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(response.mockedUploadOptions)),
    {
      toUrl: 'http://10.0.0.195:9000/circle/avatars/test.jpeg?signature=123',
      binaryStreamOnly: true,
      files: [
        {
          name: 'file',
          filename: 'test.jpeg',
          filepath: '/data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
          filetype: 'image/jpeg',
        },
      ],
      headers: {
        'Content-Type': 'image/jpeg',
      },
      method: 'PUT',
    },
  );
  assert.equal(__getRnfsUploadCalled(), true);
});

test('android local file upload stops the native RNFS job when the timeout wins', async () => {
  const {
    uploadLocalFileToPresignedUrl,
    __setRnfsShouldHang,
    __getStoppedUploadJobId,
  } = loadUploadApi();

  __setRnfsShouldHang(true);

  await assert.rejects(
    () =>
      uploadLocalFileToPresignedUrl(
        'http://10.0.0.195:9000/circle/avatars/test.jpeg?signature=123',
        'image/jpeg',
        'file:///data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
        1,
      ),
    /上传超时/,
  );

  assert.equal(__getStoppedUploadJobId(), 7);
});

test('local file upload rejects localhost presigned urls before native upload', async () => {
  const { uploadLocalFileToPresignedUrl } = loadUploadApi();

  await assert.rejects(
    () =>
      uploadLocalFileToPresignedUrl(
        'http://localhost:9000/circle/avatars/test.jpeg?signature=123',
        'image/jpeg',
        'file:///data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
      ),
    /localhost.*403/,
  );
});
