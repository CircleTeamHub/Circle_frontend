const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const UPLOAD_URL = 'https://storage.example/private/video.mp4?signature=secret';
const HEADERS = {
  'Content-Type': 'video/mp4',
  'Content-Length': '1000',
  'If-None-Match': '*',
};

function loadUpload({ platform = 'web', nativeResult, nativeError, hang = false, cancelError, statWait, presignWait, blobWait } = {}) {
  const filePath = path.join(process.cwd(), 'src/services/api/upload.ts');
  const source = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const tasks = [];
  const reports = [];
  const nativeCalls = [];
  const cancellations = [];
  const requests = [];
  const pendingTimers = new Set();
  const blob = { size: 1000 };
  const apiCalls = [];
  let generation = 0;
  let nativeProgress;

  class MockXMLHttpRequest {
    constructor() {
      this.upload = {};
      this.headers = {};
      this.status = 200;
      this.responseText = '';
      this.aborted = false;
      requests.push(this);
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
  }

  const nativePromise = () => hang
    ? new Promise(() => {})
    : nativeError
      ? Promise.reject(nativeError)
      : Promise.resolve(nativeResult ?? { status: 200, body: '' });
  const context = {
    module: { exports: {} }, exports: {}, URL, AbortController, Error,
    XMLHttpRequest: MockXMLHttpRequest,
    setTimeout: (callback, delay) => {
      const timer = setTimeout(() => { pendingTimers.delete(timer); callback(); }, delay);
      pendingTimers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => { pendingTimers.delete(timer); clearTimeout(timer); },
    fetch: async (url) => {
      if (url !== 'blob:local-video') return { ok: true, status: 200 };
      return { ok: true, blob: async () => { if (blobWait) await blobWait; return blob; } };
    },
    require: (request) => {
      switch (request) {
        case '@/services/api/client': return { apiClient: async (...args) => {
          apiCalls.push(args);
          if (presignWait) await presignWait;
          return { uploadUrl: UPLOAD_URL, key: 'notes/video.mp4', requiredHeaders: { ...HEADERS } };
        } };
        case '@/constants/config': return { API_URL: 'https://api.example' };
        case 'react-native': return { Platform: { OS: platform } };
        case '@/stores/upload-progress-store': return {
          captureUploadProgressScope: () => {
            const captured = generation;
            return () => captured === generation;
          },
          startUploadProgress: (contentType, options) => {
            const task = { contentType, options, updates: [], finished: false, finishes: 0 };
            tasks.push(task);
            return {
              update: (loaded, total) => {
                if (task.finished) return;
                task.updates.push({ loaded, total: total ?? null });
                options?.onProgress?.({ loaded, total: total ?? null });
              },
              finish: () => { task.finished = true; task.finishes++; },
            };
          },
        };
        case 'expo-file-system/legacy': return {
          FileSystemUploadType: { BINARY_CONTENT: 0 },
          getInfoAsync: async () => {
            if (statWait) await statWait;
            return { exists: true, isDirectory: false, size: 1000 };
          },
          createUploadTask: (url, uri, options, progress) => {
            nativeCalls.push({ transport: 'expo', url, uri, options });
            nativeProgress = progress;
            return {
              uploadAsync: nativePromise,
              cancelAsync: async () => { cancellations.push(platform); if (cancelError) throw cancelError; },
            };
          },
        };
        case '@/utils/validate': return {
          isPlainObject: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
          isNonEmptyString: (value) => typeof value === 'string' && value.length > 0,
          expectShape: (value, predicate, message) => {
            if (!predicate(value)) throw new Error(message);
            return value;
          },
        };
        case '@/observability/sentry': return { reportError: (error, context) => reports.push({ error, context }) };
        case '@/i18n': return { __esModule: true, default: { t: (_key, opts) => opts.defaultValue } };
        default: return require(request);
      }
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(source, context, { filename: filePath });
  return {
    ...context.module.exports, tasks, reports, nativeCalls, cancellations, requests, pendingTimers, blob, apiCalls,
    resetSession: () => { generation++; },
    emitNativeProgress: (loaded, total) => nativeProgress?.({ totalBytesSent: loaded, totalBytesExpectedToSend: total }),
  };
}

test('session reset during local stat prevents requesting a presign', async () => {
  let resolveStat;
  const statWait = new Promise((resolve) => { resolveStat = resolve; });
  const api = loadUpload({ platform: 'android', statWait });
  const pending = api.requestUploadPresign({ filename: 'video.mp4', contentType: 'video/mp4', folder: 'notes', fileUri: 'file:///tmp/video.mp4' });
  api.resetSession();
  resolveStat();
  await assert.rejects(pending, /登录状态已变更/);
  assert.equal(api.apiCalls.length, 0);
  assert.equal(api.tasks.length, 0);
});

test('session reset while a presign is pending rejects its result without creating progress', async () => {
  let resolvePresign;
  const presignWait = new Promise((resolve) => { resolvePresign = resolve; });
  const api = loadUpload({ platform: 'android', presignWait });
  const pending = api.requestUploadPresign({ filename: 'video.mp4', contentType: 'video/mp4', folder: 'notes', sizeBytes: 1000 });
  assert.equal(api.apiCalls.length, 1);
  api.resetSession();
  resolvePresign();
  await assert.rejects(pending, /登录状态已变更/);
  assert.equal(api.tasks.length, 0);
  assert.equal(api.nativeCalls.length, 0);
});

for (const platform of ['android', 'ios', 'web']) {
  test(`${platform} cannot start a queued local upload using previous-session presign headers`, async () => {
    const api = loadUpload({ platform });
    const presign = await api.requestUploadPresign({ filename: 'video.mp4', contentType: 'video/mp4', folder: 'notes', sizeBytes: 1000 });
    api.resetSession();
    await assert.rejects(api.uploadLocalFileToPresignedUrl(presign.uploadUrl, 'video/mp4', platform === 'web' ? 'blob:local-video' : 'file:///tmp/video.mp4', presign.requiredHeaders, 1), /登录状态已变更/);
    assert.equal(api.tasks.length, 0);
    assert.equal(api.nativeCalls.length, 0);
    assert.equal(api.requests.length, 0);
  });
}

test('web cannot start a queued Blob upload using previous-session presign headers', async () => {
  const api = loadUpload();
  const presign = await api.requestUploadPresign({ filename: 'video.mp4', contentType: 'video/mp4', folder: 'notes', sizeBytes: 1000 });
  api.resetSession();
  await assert.rejects(api.uploadFileToPresignedUrl(presign.uploadUrl, 'video/mp4', api.blob, presign.requiredHeaders, 1), /登录状态已变更/);
  assert.equal(api.tasks.length, 0);
  assert.equal(api.requests.length, 0);
});

test('web rechecks the presign session after awaiting a local Blob', async () => {
  let resolveBlob;
  const blobWait = new Promise((resolve) => { resolveBlob = resolve; });
  const api = loadUpload({ blobWait });
  const presign = await api.requestUploadPresign({ filename: 'video.mp4', contentType: 'video/mp4', folder: 'notes', sizeBytes: 1000 });
  const pending = api.uploadLocalFileToPresignedUrl(presign.uploadUrl, 'video/mp4', 'blob:local-video', presign.requiredHeaders, 1);
  api.resetSession();
  resolveBlob();
  await assert.rejects(pending, /登录状态已变更/);
  assert.equal(api.tasks.length, 0);
  assert.equal(api.requests.length, 0);
});

test('fresh presign headers after a reset can start a new-session native transfer', async () => {
  const api = loadUpload({ platform: 'android' });
  await api.requestUploadPresign({ filename: 'old.mp4', contentType: 'video/mp4', folder: 'notes', sizeBytes: 1000 });
  api.resetSession();
  const presign = await api.requestUploadPresign({ filename: 'video.mp4', contentType: 'video/mp4', folder: 'notes', sizeBytes: 1000 });
  await api.uploadLocalFileToPresignedUrl(presign.uploadUrl, 'video/mp4', 'file:///tmp/video.mp4', presign.requiredHeaders);
  assert.equal(api.tasks.length, 1);
  assert.equal(api.tasks[0].finishes, 1);
  assert.equal(api.nativeCalls.length, 1);
});

for (const platform of ['android', 'ios']) {
  test(`${platform} streams native file bytes into one progress reporter and finishes on success`, async () => {
    const api = loadUpload({ platform });
    const progress = [];
    const options = { progressKey: 'note-attachment-1', onProgress: (event) => progress.push(event) };
    const pending = api.uploadLocalFileToPresignedUrl(UPLOAD_URL, 'video/mp4', 'file:///tmp/video.mp4', HEADERS, 1000, options);
    api.emitNativeProgress(250, 1000);
    api.emitNativeProgress(800, 1000);
    await pending;

    assert.equal(api.tasks.length, 1);
    assert.equal(api.tasks[0].contentType, 'video/mp4');
    assert.equal(api.tasks[0].options, options);
    assert.deepEqual(progress, [{ loaded: 250, total: 1000 }, { loaded: 800, total: 1000 }]);
    assert.equal(api.tasks[0].finishes, 1);
    assert.equal(api.pendingTimers.size, 0);
    api.emitNativeProgress(1000, 1000);
    assert.equal(progress.length, 2, 'late native events must not update a finished task');
    assert.equal(api.nativeCalls[0].transport, 'expo', 'native progress must come from Expo streaming upload tasks');
    assert.equal(api.nativeCalls[0].url, UPLOAD_URL);
    assert.equal(api.nativeCalls[0].uri, 'file:///tmp/video.mp4');
    const nativeOptions = api.nativeCalls[0].options;
    assert.deepEqual(JSON.parse(JSON.stringify(nativeOptions.headers)), HEADERS);
    assert.equal(nativeOptions.httpMethod, 'PUT');
    assert.equal(nativeOptions.uploadType, 0);
  });

  test(`${platform} timeout cancels the native transfer and removes progress`, async () => {
    const api = loadUpload({ platform, hang: true, cancelError: new Error('cancellation failed') });
    const pending = api.uploadLocalFileToPresignedUrl(UPLOAD_URL, 'video/mp4', 'file:///tmp/video.mp4', HEADERS, 1);
    api.emitNativeProgress(200, 1000);
    await assert.rejects(pending, /上传超时/);
    assert.deepEqual(api.cancellations, [platform]);
    assert.equal(api.tasks.length, 1);
    assert.equal(api.tasks[0].finishes, 1);
    api.emitNativeProgress(900, 1000);
    assert.deepEqual(api.tasks[0].updates, [{ loaded: 200, total: 1000 }]);
    assert.equal(api.pendingTimers.size, 0);
    assert.equal(api.reports.length, 1);
  });

  test(`${platform} transport rejection finishes progress`, async () => {
    const api = loadUpload({ platform, nativeError: new Error('offline') });
    await assert.rejects(api.uploadLocalFileToPresignedUrl(UPLOAD_URL, 'video/mp4', 'file:///tmp/video.mp4', HEADERS), /offline/);
    assert.equal(api.tasks.length, 1);
    assert.equal(api.tasks[0].finishes, 1);
    assert.equal(api.pendingTimers.size, 0);
    assert.deepEqual(api.cancellations, [platform], 'failed Expo tasks need native subscription cleanup');
  });
}

test('web XHR reports actual bytes, preserves raw PUT headers, and removes event handlers on success', async () => {
  const api = loadUpload();
  const progress = [];
  const pending = api.uploadFileToPresignedUrl(UPLOAD_URL, 'video/mp4', api.blob, HEADERS, 1000, { onProgress: (event) => progress.push(event) });
  const xhr = api.requests[0];
  assert.ok(xhr, 'browser uploads must expose an XHR progress event');
  assert.equal(xhr.method, 'PUT');
  assert.equal(xhr.url, UPLOAD_URL);
  assert.equal(xhr.body, api.blob);
  assert.deepEqual(xhr.headers, HEADERS);
  const lateProgress = xhr.upload.onprogress;
  xhr.upload.onprogress({ loaded: 250, total: 1000, lengthComputable: true });
  xhr.upload.onprogress({ loaded: 500, total: 0, lengthComputable: false });
  xhr.onload();
  await pending;

  assert.deepEqual(progress, [{ loaded: 250, total: 1000 }, { loaded: 500, total: null }]);
  assert.equal(api.tasks[0].finishes, 1);
  assert.equal(api.pendingTimers.size, 0);
  assert.equal(xhr.upload.onprogress, null);
  assert.equal(xhr.onload, null);
  assert.equal(xhr.onerror, null);
  assert.equal(xhr.onabort, null);
  lateProgress({ loaded: 1000, total: 1000, lengthComputable: true });
  assert.equal(progress.length, 2);
});

test('web local URI delegates to exactly one transfer progress reporter', async () => {
  const api = loadUpload();
  const options = { progressKey: 'note-attachment-1' };
  const pending = api.uploadLocalFileToPresignedUrl(UPLOAD_URL, 'video/mp4', 'blob:local-video', HEADERS, 1000, options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.requests.length, 1);
  assert.equal(api.tasks.length, 1);
  assert.equal(api.tasks[0].options, options);
  api.requests[0].onload();
  await pending;
  assert.equal(api.tasks[0].finishes, 1);
  assert.equal(api.pendingTimers.size, 0);
});

test('web storage rejection retains safe status and code and finishes progress', async () => {
  const api = loadUpload();
  const pending = api.uploadFileToPresignedUrl(UPLOAD_URL, 'video/mp4', api.blob, HEADERS);
  const xhr = api.requests[0];
  assert.ok(xhr, 'browser storage requests must use XHR');
  xhr.status = 403;
  xhr.responseText = '<Error><Code>AccessDenied</Code><Key>private-name</Key><RequestId>private-id</RequestId></Error>';
  xhr.onload();
  await assert.rejects(pending, (error) => error.status === 403 && error.storageCode === 'AccessDenied');
  assert.equal(api.tasks[0].finishes, 1);
  assert.equal(api.pendingTimers.size, 0);
  assert.equal(api.reports.length, 1);
  assert.doesNotMatch(JSON.stringify(api.reports), /private-|signature=secret/);
});

test('web network failure removes handlers and finishes progress', async () => {
  const api = loadUpload();
  const pending = api.uploadFileToPresignedUrl(UPLOAD_URL, 'video/mp4', api.blob, HEADERS);
  const xhr = api.requests[0];
  assert.ok(xhr, 'browser storage requests must use XHR');
  xhr.onerror();
  await assert.rejects(pending, /上传失败/);
  assert.equal(api.tasks[0].finishes, 1);
  assert.equal(api.pendingTimers.size, 0);
  assert.equal(xhr.upload.onprogress, null);
});

test('web timeout aborts the actual XHR and finishes progress', async () => {
  const api = loadUpload();
  const pending = api.uploadFileToPresignedUrl(UPLOAD_URL, 'video/mp4', api.blob, HEADERS, 1);
  const xhr = api.requests[0];
  assert.ok(xhr, 'browser storage requests must use XHR');
  await assert.rejects(pending, /上传超时/);
  assert.equal(xhr.aborted, true);
  assert.equal(api.tasks[0].finishes, 1);
  assert.equal(api.pendingTimers.size, 0);
  assert.equal(xhr.upload.onprogress, null);
  assert.equal(api.reports.length, 1);
});
