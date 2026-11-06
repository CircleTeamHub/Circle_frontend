const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadNative(overrides = {}) {
  const reports = [];
  const fileSystem = { cacheDirectory: 'file:///cache/', downloadAsync: async () => ({ status: 200, uri: 'file:///cache/download' }), deleteAsync: async () => undefined, ...overrides.fileSystem };
  const library = { requestPermissionsAsync: async () => ({ granted: true }), saveToLibraryAsync: async () => undefined, ...overrides.library };
  const module = loadTsModule('src/utils/save-image.ts', { requireShim: (request) => {
    if (request === 'expo-file-system/legacy') return fileSystem;
    if (request === 'expo-media-library') return library;
    if (request === '@/observability/report-failure') return { reportHandledFailure: (...args) => reports.push(args) };
    throw new Error(`Unexpected module ${request}`);
  } });
  return { ...module, reports };
}

test('native media download and album failures retain the original exception and report only once', async () => {
  for (const stage of ['download', 'album']) {
    const error = new Error('native operation unavailable');
    const utils = loadNative(stage === 'download'
      ? { fileSystem: { downloadAsync: async () => { throw error; } } }
      : { library: { saveToLibraryAsync: async () => { throw error; } } });
    assert.equal(await utils.saveMediaToLibrary('https://private.example/media?token=secret'), 'failed');
    assert.deepEqual(utils.reports, [['mediaSave', stage === 'download' ? 'download' : 'save', error]]);
  }
});

test('native album permission denial remains expected', async () => {
  const utils = loadNative({ library: { requestPermissionsAsync: async () => ({ granted: false }) } });
  assert.equal(await utils.saveMediaToLibrary('https://private.example/media'), 'denied');
  assert.deepEqual(utils.reports, []);
});

test('a non-successful native download is observable with only its HTTP status', async () => {
  const utils = loadNative({ fileSystem: { downloadAsync: async () => ({ status: 503, uri: 'file:///cache/download' }) } });
  assert.equal(await utils.saveMediaToLibrary('https://private.example/media?token=secret'), 'failed');
  assert.equal(utils.reports.length, 1);
  assert.deepEqual(utils.reports[0].slice(0, 2), ['mediaSave', 'download']);
  assert.equal(utils.reports[0][3].status, 503);
  assert.equal(JSON.stringify(utils.reports).includes('private.example'), false);
  assert.equal(JSON.stringify(utils.reports).includes('secret'), false);
});

function loadWeb(open) {
  const reports = []; const diagnostics = [];
  const error = new TypeError('CORS request failed');
  const module = loadTsModule('src/utils/save-image.web.ts', {
    requireShim: (request) => {
      if (request === '@/observability/report-failure') return { reportHandledFailure: (...args) => reports.push(args) };
      if (request === '@/utils/client-diagnostics') return { logClientDiagnostic: (...args) => diagnostics.push(args) };
      throw new Error(`Unexpected module ${request}`);
    },
    context: { document: {}, fetch: async () => { throw error; }, window: { open } },
  });
  return { ...module, reports, diagnostics };
}

test('a successful browser fallback records a breadcrumb without reporting an expected CORS error', async () => {
  const utils = loadWeb(() => ({ opener: {} }));
  assert.equal(await utils.saveMediaToLibrary('https://private.example/media?token=secret'), 'saved');
  assert.deepEqual(utils.reports, []);
  assert.equal(utils.diagnostics.length, 1);
  assert.equal(utils.diagnostics[0][0], 'mediaSave.download.fallback');
  assert.equal(JSON.stringify(utils.diagnostics).includes('private.example'), false);
});

test('a blocked browser fallback records expected browser policy without reporting an exception', async () => {
  const utils = loadWeb(() => null);
  assert.equal(await utils.saveMediaToLibrary('https://private.example/media?token=secret'), 'failed');
  assert.deepEqual(utils.reports, []);
  assert.equal(utils.diagnostics[1][0], 'mediaSave.browserFallback.blocked');
});

test('a throwing browser fallback reports the unsuccessful save', async () => {
  const error = new Error('open unavailable');
  const utils = loadWeb(() => { throw error; });
  assert.equal(await utils.saveMediaToLibrary('https://private.example/media?token=secret'), 'failed');
  assert.deepEqual(utils.reports, [['mediaSave', 'browserFallback', error]]);
  assert.equal(JSON.stringify(utils.reports).includes('private.example'), false);
});
