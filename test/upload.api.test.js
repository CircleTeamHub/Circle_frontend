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
            uploadFiles: (options) => ({
              jobId: 1,
              promise: Promise.resolve({
                statusCode: 200,
                headers: {},
                body: '',
                mockedUploadOptions: options,
              }),
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

test('upload.ts does not dynamically import react-native-fs on send path', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/upload.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /import\(['"]react-native-fs['"]\)/);
  assert.match(source, /require\(['"]react-native-fs['"]\)/);
});

test('android rejects localhost presigned upload urls', async () => {
  const { requestUploadPresign } = loadUploadApi();

  await assert.rejects(
    () =>
      requestUploadPresign({
        filename: 'avatar.jpeg',
        contentType: 'image/jpeg',
        folder: 'avatars',
      }),
    /localhost/,
  );
});

test('local file upload delegates to expo-file-system uploadAsync', async () => {
  const { uploadLocalFileToPresignedUrl } = loadUploadApi();

  const response = await uploadLocalFileToPresignedUrl(
    'http://localhost:9000/circle/avatars/test.jpeg?signature=123',
    'image/jpeg',
    'file:///data/user/0/com.yiboding.circleim/cache/ImagePicker/test.jpeg',
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(response.mockedUploadOptions)),
    {
      toUrl: 'http://localhost:9000/circle/avatars/test.jpeg?signature=123',
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
});
