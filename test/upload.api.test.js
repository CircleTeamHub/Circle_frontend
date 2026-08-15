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
  let platformOS = 'android';
  // 默认 localhost:另有用例专门断言「手机端拒绝 localhost 预签名地址」。
  let presignHost = 'http://localhost:9000';

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
            uploadUrl: `${presignHost}/circle/avatars/test.jpeg?signature=123`,
            fileUrl: `${presignHost}/circle/avatars/test.jpeg`,
            key: 'avatars/test.jpeg',
            requiredHeaders: {
              'Content-Type': 'image/jpeg',
              'Content-Length': '12345',
              'If-None-Match': '*',
            },
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
            get OS() {
              return platformOS;
            },
          },
        };
      }
      if (request === 'expo-file-system/legacy') {
        return {
          FileSystemUploadType: {
            BINARY_CONTENT: 0,
          },
          getInfoAsync: async (uri) =>
            uri.includes('missing')
              ? { exists: false }
              : { exists: true, uri, size: 12345, isDirectory: false },
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
  context.module.exports.__setPresignHost = (host) => {
    presignHost = host;
  };
  context.module.exports.__setPlatformOS = (value) => {
    platformOS = value;
  };
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
        sizeBytes: 1024,
      }),
    /localhost.*403/,
  );
});

test('presign 必须带 sizeBytes(后端 PresignDto 必填),且 fileUri 不进请求体', async () => {
  // 少了 sizeBytes 后端直接 400:
  // "sizeBytes must not be greater than 104857600; must not be less than 1;
  //  must be an integer number"(三条一起报 = 字段压根没送到)。
  const { requestUploadPresign, __setPresignHost } = loadUploadApi();
  __setPresignHost('http://10.0.0.195:9000');

  const response = await requestUploadPresign({
    filename: 'photo.jpeg',
    contentType: 'image/jpeg',
    folder: 'chat',
    fileUri: 'file:///tmp/ImagePicker/photo.jpeg',
  });

  const [url, init] = response.args;
  assert.equal(url, '/upload/presign');
  // vm realm 里的对象原型与宿主不同,deepStrictEqual 会误报 —— 走一次 JSON。
  assert.deepEqual(JSON.parse(JSON.stringify(init.body)), {
    filename: 'photo.jpeg',
    contentType: 'image/jpeg',
    folder: 'chat',
    // 来自 getInfoAsync,不是调用方自己算的 —— 签名要的是真实字节数。
    sizeBytes: 12345,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(response.requiredHeaders)), {
    'Content-Type': 'image/jpeg',
    'Content-Length': '12345',
    'If-None-Match': '*',
  });
});

test('拿不到文件尺寸时给可读的错,而不是送一个坏 sizeBytes 上去', async () => {
  const { requestUploadPresign } = loadUploadApi();

  await assert.rejects(
    () =>
      requestUploadPresign({
        filename: 'gone.jpeg',
        contentType: 'image/jpeg',
        folder: 'chat',
        fileUri: 'file:///tmp/missing.jpeg',
      }),
    /找不到要上传的文件/,
  );
});

test('超过后端 100MB 上限的文件在本地就拦下', async () => {
  const { requestUploadPresign } = loadUploadApi();

  await assert.rejects(
    () =>
      requestUploadPresign({
        filename: 'huge.mp4',
        contentType: 'video/mp4',
        folder: 'chat',
        sizeBytes: 100 * 1024 * 1024 + 1,
      }),
    /100MB/,
  );
});

test('android local file upload preserves the presigned host and delegates to cancellable RNFS upload', async () => {
  const { uploadLocalFileToPresignedUrl, __getRnfsUploadCalled } = loadUploadApi();

  const response = await uploadLocalFileToPresignedUrl(
    'http://10.0.0.195:9000/circle/avatars/test.jpeg?signature=123',
    'image/jpeg',
    'file:///data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
    {
      'Content-Type': 'image/jpeg',
      'Content-Length': '12345',
      'If-None-Match': '*',
    },
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
        'Content-Length': '12345',
        'If-None-Match': '*',
      },
      method: 'PUT',
    },
  );
  assert.equal(__getRnfsUploadCalled(), true);
});

test('ios local file upload forwards every header required by the presign response', async () => {
  const { uploadLocalFileToPresignedUrl, __setPlatformOS } = loadUploadApi();
  __setPlatformOS('ios');
  const requiredHeaders = {
    'Content-Type': 'image/jpeg',
    'Content-Length': '12345',
    'If-None-Match': '*',
  };

  const response = await uploadLocalFileToPresignedUrl(
    'http://10.0.0.195:9000/circle/chat/test.jpeg?signature=123',
    'image/jpeg',
    'file:///tmp/ImagePicker/test.jpeg',
    requiredHeaders,
  );

  const options = response.mockedUploadArgs[2];
  assert.deepEqual(
    JSON.parse(JSON.stringify(options.headers)),
    requiredHeaders,
  );
  assert.equal(options.uploadType, 0);
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
        {
          'Content-Type': 'image/jpeg',
          'Content-Length': '12345',
          'If-None-Match': '*',
        },
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
        {
          'Content-Type': 'image/jpeg',
          'Content-Length': '12345',
          'If-None-Match': '*',
        },
      ),
    /localhost.*403/,
  );
});
