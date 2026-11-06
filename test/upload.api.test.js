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

  let nativeUploadTaskCalled = false;
  let nativeTaskCancelled = false;
  let nativeShouldHang = false;
  let platformOS = 'android';
  // 默认 localhost:另有用例专门断言移动端拒绝不可访问的上传地址。
  let presignHost = 'http://localhost:9000';
  // 逐用例覆盖 presign 响应字段(比如私有目录的 fileUrl 为 null / 缺省)。
  let presignOverrides = {};

  const context = {
    module: { exports: {} },
    exports: {},
    URL,
    setTimeout,
    clearTimeout,
    require: (request) => {
      if (request === '@/observability/tracing') return { startOperationSpan: () => ({ end() {} }) };
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
            ...presignOverrides,
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
      if (request === '@/stores/upload-progress-store') {
        return {
          captureUploadProgressScope: () => () => true,
          startUploadProgress: () => ({ update: () => {}, finish: () => {} }),
        };
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
          createUploadTask: (...args) => {
            nativeUploadTaskCalled = true;
            return {
              uploadAsync: () => nativeShouldHang
                ? new Promise(() => {})
                : Promise.resolve({
                  status: 200,
                  headers: {},
                  mimeType: null,
                  body: '',
                  mockedUploadArgs: args,
                }),
              cancelAsync: async () => { nativeTaskCancelled = true; },
            };
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
  context.module.exports.__getNativeUploadTaskCalled = () => nativeUploadTaskCalled;
  context.module.exports.__setNativeShouldHang = (value) => {
    nativeShouldHang = value;
  };
  context.module.exports.__getNativeTaskCancelled = () => nativeTaskCancelled;
  context.module.exports.__setPresignHost = (host) => {
    presignHost = host;
  };
  context.module.exports.__setPresignOverrides = (value) => {
    presignOverrides = value;
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

test('installed Expo Android upload tasks count a streamed file body after native sink writes', () => {
  // This transport choice relies on file-backed OkHttp bodies. RNFS raw uploads
  // instead buffer HttpURLConnection output before sending it to the network.
  const nativeDirectory = path.join(process.cwd(), 'node_modules/expo-file-system/android/src/main/java/expo/modules/filesystem/legacy');
  const nativeSource = fs.readFileSync(path.join(nativeDirectory, 'FileSystemLegacyModule.kt'), 'utf8');
  const countingSource = fs.readFileSync(
    path.join(nativeDirectory, 'CountingRequestBody.kt'),
    'utf8',
  );
  assert.match(nativeSource, /AsyncFunction\("uploadTaskStartAsync"\)[\s\S]*?CountingRequestBody\(requestBody, progressListener\)/);
  assert.match(nativeSource, /FileSystemUploadType\.BINARY_CONTENT ->\s*\{\s*decorator\.decorate\(file\.asRequestBody\(null\)\)/);
  assert.match(countingSource, /super\.write\(source, byteCount\)[\s\S]*?bytesWritten \+= byteCount[\s\S]*?progressListener\.onProgress\(bytesWritten, requestBody\.contentLength\(\)\)/);
  assert.match(countingSource, /requestBody\.writeTo\(bufferedSink\)/);
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
    /暂时无法上传，请稍后重试/,
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

test('android local file upload preserves the signed host and URI through an Expo binary upload task', async () => {
  const { uploadLocalFileToPresignedUrl, __getNativeUploadTaskCalled } = loadUploadApi();

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
    JSON.parse(JSON.stringify(response.mockedUploadArgs.slice(0, 3))),
    [
      'http://10.0.0.195:9000/circle/avatars/test.jpeg?signature=123',
      'file:///data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
      {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': '12345',
          'If-None-Match': '*',
        },
        httpMethod: 'PUT',
        uploadType: 0,
      },
    ],
  );
  assert.equal(__getNativeUploadTaskCalled(), true);
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

test('android local file upload cancels the Expo native task when the timeout wins', async () => {
  const {
    uploadLocalFileToPresignedUrl,
    __setNativeShouldHang,
    __getNativeTaskCancelled,
  } = loadUploadApi();

  __setNativeShouldHang(true);

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

  assert.equal(__getNativeTaskCancelled(), true);
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
    /暂时无法上传，请稍后重试/,
  );
});

// chat/、notes/ 是私有目录：fileUrl 直连读不到，调用方只认 key。后端之后可能对它们
// 返回 null —— 校验不能因此把聊天/笔记上传整个拒掉。
test('private folders accept a presign without a directly readable fileUrl', async () => {
  const api = loadUploadApi();
  api.__setPresignHost('http://10.0.0.195:9000');
  for (const fileUrl of [undefined, null]) {
    api.__setPresignOverrides({ fileUrl, key: 'chat/user-1/voice.m4a' });
    const response = await api.requestUploadPresign({
      filename: 'voice.m4a',
      contentType: 'audio/mp4',
      folder: 'chat',
      sizeBytes: 1024,
    });
    assert.equal(response.key, 'chat/user-1/voice.m4a');
    assert.equal(response.fileUrl ?? null, null);
  }
});

// 公开目录的调用方直接把 fileUrl 写进资料 / 圈子 / 帖子：既要拿得到，缺了也照旧拒绝。
test('public folders forward fileUrl verbatim to the caller', async () => {
  const api = loadUploadApi();
  api.__setPresignHost('http://10.0.0.195:9000');
  api.__setPresignOverrides({ fileUrl: 'http://10.0.0.195:9000/circle/avatars/test.jpeg' });
  const response = await api.requestUploadPresign({
    filename: 'avatar.jpg',
    contentType: 'image/jpeg',
    folder: 'avatars',
    sizeBytes: 1024,
  });
  assert.equal(response.fileUrl, 'http://10.0.0.195:9000/circle/avatars/test.jpeg');
});

test('public folders still require fileUrl because callers persist it directly', async () => {
  const api = loadUploadApi();
  api.__setPresignHost('http://10.0.0.195:9000');
  api.__setPresignOverrides({ fileUrl: null });
  await assert.rejects(
    api.requestUploadPresign({
      filename: 'avatar.jpg',
      contentType: 'image/jpeg',
      folder: 'avatars',
      sizeBytes: 1024,
    }),
    /暂时无法上传，请稍后重试/,
  );
});
