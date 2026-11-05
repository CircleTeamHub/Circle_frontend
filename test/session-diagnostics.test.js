const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadJournal({ disk = new Map(), failStorage = false, failRead = () => false, idOffset = 0, now = 1793868600000, breadcrumbs = [] } = {}) {
  let counter = idOffset;
  return loadTsModule('src/observability/session-diagnostics.ts', {
    requireShim: request => {
      if (request === 'expo-application') return { nativeApplicationVersion: '1.0.1', nativeBuildVersion: '100001291' };
      if (request === 'react-native') return { Platform: { OS: 'android' } };
      if (request === '@react-native-async-storage/async-storage') return {
        default: {
        getItem: async key => { if (failStorage || failRead()) throw new Error('storage unavailable'); return disk.get(key) ?? null; },
        setItem: async (key, value) => { if (failStorage) throw new Error('storage unavailable'); disk.set(key, value); },
        },
      };
      if (request === '@/utils/client-diagnostics') return { readDiagnosticBreadcrumbs: () => breadcrumbs };
      if (request === './http-diagnostics') {
        const actual = loadTsModule('src/observability/http-diagnostics.ts');
        return { ...actual, createHttpRequestId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
      }
      return require(request);
    },
    context: { Date: class extends Date { static now() { return now; } } },
  });
}

test('session diagnostics survive logout-style buffer clearing and a new runtime', async () => {
  const disk = new Map();
  const breadcrumbs = [{ timestamp: 1793868599000, event: 'api.request.completed', details: {
    endpointPath: '/auth/refresh', method: 'POST', status: 201,
    requestId: '12345678-1234-4234-8234-123456789abc',
  } }];
  const journal = loadJournal({ disk, breadcrumbs });
  assert.equal(typeof journal.recordSessionDiagnostic, 'function');
  const id = journal.recordSessionDiagnostic('refresh-response-invalid', { status: 201, endpointPath: '/auth/refresh' });
  breadcrumbs.length = 0;
  await journal.readSessionDiagnostics();
  const restored = await loadJournal({ disk }).readSessionDiagnostics();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, id);
  assert.equal(restored[0].reason, 'refresh-response-invalid');
  assert.equal(restored[0].requests[0].context.requestId, '12345678-1234-4234-8234-123456789abc');
  assert.equal(restored[0].context.status, 201);
  assert.equal(restored[0].appVersion, '1.0.1');
  assert.equal(restored[0].buildVersion, '100001291');
  assert.equal(restored[0].platform, 'android');
});

test('preserved-session refresh anomalies retain safe response metadata across restart', async () => {
  const disk = new Map();
  const journal = loadJournal({ disk });
  journal.recordSessionDiagnostic('refresh-response-invalid', {
    status: 201, responseShape: 'unknown', failureKind: 'body-read', sessionPreserved: true,
  });
  await journal.readSessionDiagnostics();
  const [restored] = await loadJournal({ disk }).readSessionDiagnostics();
  assert.equal(restored.context.sessionPreserved, true);
  assert.equal(restored.context.responseShape, 'unknown');
  assert.equal(restored.context.failureKind, 'body-read');
  assert.equal(restored.context.status, 201);
});

test('replayed auth response correlation survives restart without admitting arbitrary identifiers', async () => {
  const disk = new Map();
  const journal = loadJournal({ disk });
  const initialRequestId = '12345678-1234-4234-8234-123456789abc';
  const clientRequestId = '87654321-4321-4321-8321-cba987654321';
  journal.recordSessionDiagnostic('auth-retry-response-replayed', {
    requestId: initialRequestId, initialRequestId, clientRequestId,
    failureKind: 'auth-retry-response-replayed', status: 401, sessionPreserved: true,
  });
  await journal.readSessionDiagnostics();
  const [restored] = await loadJournal({ disk }).readSessionDiagnostics();
  assert.equal(restored.reason, 'auth-retry-response-replayed');
  assert.equal(restored.context.initialRequestId, initialRequestId);
  assert.equal(restored.context.clientRequestId, clientRequestId);
  const bad = loadJournal();
  bad.recordSessionDiagnostic('auth-retry-response-replayed', { clientRequestId: 'PRIVATE_CANARY', initialRequestId: 'PRIVATE_CANARY' });
  assert.doesNotMatch(JSON.stringify(await bad.readSessionDiagnostics()), /PRIVATE_CANARY/);
});

test('journal never keeps arbitrary strings, credentials, raw routes or account identifiers', async () => {
  const disk = new Map();
  const secret = 'PRIVATE_CANARY';
  const journal = loadJournal({ disk, breadcrumbs: [
    { timestamp: 1793868599000, event: 'chat.private', details: { conversationID: secret } },
    { timestamp: 1793868599000, event: 'api.request.failed', details: {
      endpointPath: `/qr/tokens/${secret}/accept?secret=${secret}`, method: 'GET', status: 401,
      requestId: secret, token: secret, message: secret, failureKind: secret,
    } },
  ] });
  assert.equal(typeof journal.recordSessionDiagnostic, 'function');
  journal.recordSessionDiagnostic('refresh-rejected', {
    endpointPath: `/note/${secret}`, method: secret, status: 401, requestId: secret,
    accessToken: secret, refreshToken: secret, userId: secret, deviceId: secret,
    message: secret, failureKind: secret,
  });
  const rows = await journal.readSessionDiagnostics();
  assert.equal(rows[0].context.endpointPath, '/note/:id');
  assert.equal(rows[0].requests.length, 1);
  assert.equal(rows[0].requests[0].context.endpointPath, '/qr/tokens/:id/accept');
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_CANARY|accessToken|refreshToken|conversationID|deviceId|userId/);
  assert.doesNotMatch([...disk.values()].join(''), /PRIVATE_CANARY/);
});

test('bounded concurrent writes preserve the last five incidents and expire old ones', async () => {
  const disk = new Map();
  const journal = loadJournal({ disk });
  assert.equal(typeof journal.recordSessionDiagnostic, 'function');
  const ids = Array.from({ length: 8 }, () => journal.recordSessionDiagnostic('realtime-revoked'));
  const rows = await journal.readSessionDiagnostics();
  assert.deepEqual(Array.from(rows, x => x.id), ids.slice(-5));
  const later = loadJournal({ disk, now: 1793868600000 + 31 * 86400000 });
  assert.equal((await later.readSessionDiagnostics()).length, 0);
});

test('storage failure leaves an in-memory copy and never throws from recording', async () => {
  const journal = loadJournal({ failStorage: true });
  assert.equal(typeof journal.recordSessionDiagnostic, 'function');
  assert.doesNotThrow(() => journal.recordSessionDiagnostic('hydration-read-failed'));
  const rows = await journal.readSessionDiagnostics();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'hydration-read-failed');
});

test('a transient read failure does not overwrite previous incidents, and recovery merges both runtimes', async () => {
  const disk = new Map();
  const first = loadJournal({ disk });
  const oldId = first.recordSessionDiagnostic('refresh-rejected');
  await first.readSessionDiagnostics();
  let readFailed = false;
  const next = loadJournal({ disk, idOffset: 10, failRead: () => {
    if (readFailed) return false;
    readFailed = true;
    return true;
  } });
  const nextId = next.recordSessionDiagnostic('hydration-read-failed');
  const rows = await next.readSessionDiagnostics();
  assert.deepEqual(Array.from(rows, row => row.id), [oldId, nextId]);
  assert.equal(JSON.parse([...disk.values()][0])[0].id, oldId);
  const thirdId = next.recordSessionDiagnostic('realtime-revoked');
  await next.readSessionDiagnostics();
  const restored = await loadJournal({ disk }).readSessionDiagnostics();
  assert.deepEqual(Array.from(restored, row => row.id), [oldId, nextId, thirdId]);
});

test('corrupt or injected stored data is not exported', async () => {
  const disk = new Map();
  const journal = loadJournal({ disk });
  assert.equal(typeof journal.recordSessionDiagnostic, 'function');
  journal.recordSessionDiagnostic('refresh-rejected');
  await journal.readSessionDiagnostics();
  const key = [...disk.keys()][0];
  const rows = JSON.parse(disk.get(key));
  rows[0].token = 'PRIVATE_CANARY';
  rows[0].appVersion = rows[0].buildVersion = rows[0].platform = 'PRIVATE_CANARY';
  rows[0].context = { status: 401, requestId: 'PRIVATE_CANARY', endpointPath: '/note/PRIVATE_CANARY', body: 'PRIVATE_CANARY' };
  rows.push({ id: 'PRIVATE_CANARY', timestamp: 1793868600000, reason: 'PRIVATE_CANARY' });
  disk.set(key, JSON.stringify(rows));
  const restored = await loadJournal({ disk }).readSessionDiagnostics();
  assert.equal(restored.length, 1);
  assert.doesNotMatch(JSON.stringify(restored), /PRIVATE_CANARY|"token"|"body"/);
  disk.set(key, '{broken');
  assert.equal((await loadJournal({ disk }).readSessionDiagnostics()).length, 0);
});
