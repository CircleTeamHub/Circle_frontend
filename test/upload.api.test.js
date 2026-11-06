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
  const convertedImages = [];
  const deletedFiles = [];
  const presignCalls = [];
  let conversionFails = false;
  let presignFails = false;
  let uploadStatus = 200;

  const context = {
    module: { exports: {} },
    exports: {},
    URL,
    setTimeout,
    clearTimeout,
    require: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: (...args) => {
            presignCalls.push(args);
            if (presignFails) throw new Error('presign failed');
            return ({
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
          });
          },
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
              : { exists: true, uri, size: uri === 'file:///converted.jpg' ? 4321 : 12345, isDirectory: false },
          deleteAsync: async (uri) => { deletedFiles.push(uri); },
          createUploadTask: (...args) => {
            nativeUploadTaskCalled = true;
            return {
              uploadAsync: () => nativeShouldHang
                ? new Promise(() => {})
                : Promise.resolve({
                  status: uploadStatus,
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
      if (request === 'expo-image-manipulator') {
        return {
          SaveFormat: { JPEG: 'jpeg' },
          manipulateAsync: async (...args) => {
            convertedImages.push(args);
            if (conversionFails) throw new Error('conversion failed');
            return { uri: 'file:///converted.jpg', width: 100, height: 100 };
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
  context.module.exports.__convertedImages = convertedImages;
  context.module.exports.__deletedFiles = deletedFiles;
  context.module.exports.__presignCalls = presignCalls;
  context.module.exports.__setConversionFails = (value) => { conversionFails = value; };
  context.module.exports.__setPresignFails = (value) => { presignFails = value; };
  context.module.exports.__setUploadStatus = (value) => { uploadStatus = value; };
  return context.module.exports;
}

for (const [filename, contentType, platform] of [
  ['avatar.HEIC', 'image/heic', 'ios'],
  ['cover.heif', 'image/heif', 'android'],
  ['circle.heic', 'image/jpeg', 'ios'],
]) {
  test(`${platform} ${filename} is converted before signing and PUT uses the same JPEG`, async () => {
    const api = loadUploadApi();
    api.__setPlatformOS(platform);
    const sourceUri = `file:///${filename}`;
    api.__setPresignHost('https://storage.example.test');
    const presign = await api.requestUploadPresign({ filename, contentType, folder: 'avatars', fileUri: sourceUri });
    const body = api.__presignCalls[0][1].body;
    assert.equal(body.filename, filename.replace(/\.[^.]+$/, '.jpg'));
    assert.equal(body.contentType, 'image/jpeg');
    assert.equal(body.sizeBytes, 4321);
    assert.equal(api.__convertedImages[0][0], sourceUri);
    assert.equal(api.__convertedImages[0][2].format, 'jpeg');
    const result = await api.uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, sourceUri, presign.requiredHeaders);
    assert.equal(result.mockedUploadArgs[1], 'file:///converted.jpg');
    assert.deepEqual(api.__deletedFiles, ['file:///converted.jpg']);
  });
}

test('JPEG and GIF uploads retain their original files', async () => {
  for (const [filename, contentType] of [['avatar.jpg', 'image/jpeg'], ['sticker.gif', 'image/gif']]) {
    const api = loadUploadApi();
    const fileUri = `file:///${filename}`;
    api.__setPresignHost('https://storage.example.test');
    const presign = await api.requestUploadPresign({ filename, contentType, folder: 'avatars', fileUri });
    const result = await api.uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, fileUri, presign.requiredHeaders);
    assert.equal(result.mockedUploadArgs[1], fileUri);
    assert.equal(api.__convertedImages.length, 0);
    assert.equal(api.__deletedFiles.length, 0);
  }
});

test('failed HEIC conversion stops before presigning or uploading', async () => {
  const api = loadUploadApi();
  api.__setConversionFails(true);
  api.__setPresignHost('https://storage.example.test');
  await assert.rejects(api.requestUploadPresign({ filename: 'avatar.heic', contentType: 'image/heic', folder: 'avatars', fileUri: 'file:///avatar.heic' }), /conversion failed/);
  assert.equal(api.__presignCalls.length, 0);
  assert.equal(api.__getNativeUploadTaskCalled(), false);
});

test('failed presign cleans the converted HEIC file', async () => {
  const api = loadUploadApi();
  api.__setPresignFails(true);
  await assert.rejects(api.requestUploadPresign({ filename: 'avatar.heic', contentType: 'image/heic', folder: 'avatars', fileUri: 'file:///avatar.heic' }), /presign failed/);
  assert.deepEqual(api.__deletedFiles, ['file:///converted.jpg']);
});

test('failed HEIC PUT cleans the converted file without reporting success', async () => {
  const api = loadUploadApi();
  api.__setPresignHost('https://storage.example.test');
  const presign = await api.requestUploadPresign({ filename: 'avatar.heic', contentType: 'image/heic', folder: 'avatars', fileUri: 'file:///avatar.heic' });
  api.__setUploadStatus(403);
  await assert.rejects(api.uploadLocalFileToPresignedUrl(presign.uploadUrl, 'image/heic', 'file:///avatar.heic', presign.requiredHeaders));
  assert.deepEqual(api.__deletedFiles, ['file:///converted.jpg']);
});

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
