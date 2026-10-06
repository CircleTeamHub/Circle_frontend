const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function load(os, fs, context = {}) {
  return loadTsModule('src/features/notes/utils/note-recording-storage.ts', {
    requireShim: (name) => {
      if (name === 'react-native') return { Platform: { OS: os } };
      if (name === 'react-native-fs') return fs;
      return require(name);
    }, context,
  });
}

function nativeFS() {
  const files = new Set(['/cache/source.m4a']);
  const directories = [];
  const removed = [];
  return { files, directories, removed, DocumentDirectoryPath: '/container/Documents',
    mkdir: async (path, options) => directories.push({ path, options }),
    copyFile: async (source, destination) => { assert.ok(files.has(source)); files.add(destination); },
    exists: async (path) => files.has(path),
    unlink: async (path) => { removed.push(path); files.delete(path); },
  };
}

test('native recording is copied out of cache with backup exclusion and restored under the current container', async () => {
  const fs = nativeFS();
  const storage = load('ios', fs);
  const stored = await storage.persistNoteRecording('owner-a', 'file:///cache/source.m4a');
  const oldPath = stored.uri.slice(7);
  assert.ok(oldPath.startsWith('/container/Documents/note-recordings-v1/account-owner-a/'));
  assert.ok(fs.files.has('/cache/source.m4a'));
  assert.equal(fs.directories.length, 2);
  assert.ok(fs.directories.every(({ options }) => options.NSURLIsExcludedFromBackupKey === true));
  fs.DocumentDirectoryPath = '/new-container/Documents';
  const newPath = oldPath.replace('/container/', '/new-container/');
  fs.files.delete(oldPath); fs.files.add(newPath);
  assert.equal(await storage.restoreNoteRecording('owner-a', stored.localRecordingId), 'file://' + newPath);
  assert.equal(await storage.restoreNoteRecording('owner-b', stored.localRecordingId), undefined);
  await storage.removeNoteRecording('owner-b', stored.localRecordingId);
  assert.ok(fs.files.has(newPath));
  await storage.removeNoteRecording('owner-a', stored.localRecordingId);
  assert.deepEqual(fs.removed, [newPath]);
  assert.ok(fs.files.has('/cache/source.m4a'));
});

test('recording cleanup rejects traversal and never accepts a source URI as a durable ID', async () => {
  const fs = nativeFS();
  const storage = load('android', fs);
  for (const id of ['../source.m4a', 'file:///cache/source.m4a', 'recording-../source.m4a', 'recording-%2f.m4a']) {
    await storage.removeNoteRecording('owner', id);
    assert.equal(await storage.restoreNoteRecording('owner', id), undefined);
  }
  await assert.rejects(storage.persistNoteRecording('../owner', 'file:///cache/source.m4a'));
  assert.equal(fs.removed.length, 0);
});

test('a failed native copy cleans only its partial destination and reports a redacted failure', async () => {
  const fs = nativeFS();
  fs.copyFile = async (_source, destination) => { fs.files.add(destination); throw new Error('private source /cache/source.m4a'); };
  const storage = load('ios', fs);
  await assert.rejects(storage.persistNoteRecording('owner', 'file:///cache/source.m4a'), (error) => error.message === 'Recording storage failed');
  assert.equal(fs.removed.length, 1);
  assert.ok(fs.removed[0].includes('/note-recordings-v1/account-owner/recording-'));
  assert.ok(fs.files.has('/cache/source.m4a'));
});

// A transactional IDB double: writes become visible only at transaction
// completion, and abort discards them. Real browser persistence still needs a
// device/browser smoke check; this proves our acknowledgement boundary.
function indexedDBDouble() {
  const values = new Map();
  const waiting = [];
  const factory = { autoCommit: true, values, waiting,
    open: () => {
      const request = {};
      queueMicrotask(() => { request.result = db; request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  };
  const db = { objectStoreNames: { contains: () => true }, close: () => {},
    transaction: () => {
      const transaction = {};
      transaction.objectStore = () => {
        const run = (getResult, commit = () => {}) => {
          const request = {};
          queueMicrotask(() => {
            request.result = getResult(); request.onsuccess?.();
            const finish = (abort = false) => { if (abort) transaction.onabort?.(); else { commit(); transaction.oncomplete?.(); } };
            if (factory.autoCommit) queueMicrotask(() => finish());
            else waiting.push(finish);
          });
          return request;
        };
        return { put: (blob, key) => run(() => key, () => values.set(key, blob)),
          get: (key) => run(() => values.get(key)), delete: (key) => run(() => undefined, () => values.delete(key)) };
      };
      return transaction;
    },
  };
  return factory;
}
function webContext(indexedDB, created) {
  return { indexedDB, fetch: async () => ({ ok: true, blob: async () => new Blob(['recorded audio'], { type: 'audio/webm' }) }),
    URL: { createObjectURL: (blob) => { assert.ok(blob.size); const uri = 'blob:restored-' + created.length; created.push(uri); return uri; } },
  };
}

test('web Blob survives a fresh helper instance and restores an object URL only for its owning account', async () => {
  const db = indexedDBDouble();
  const created = [];
  const stored = await load('web', null, webContext(db, created)).persistNoteRecording('owner-a', 'blob:temporary');
  const reloaded = load('web', null, webContext(db, created));
  assert.equal(await reloaded.restoreNoteRecording('owner-b', stored.localRecordingId), undefined);
  assert.equal(await reloaded.restoreNoteRecording('owner-a', stored.localRecordingId), 'blob:restored-0');
  await reloaded.removeNoteRecording('owner-b', stored.localRecordingId);
  assert.equal(db.values.size, 1);
  await reloaded.removeNoteRecording('owner-a', stored.localRecordingId);
  assert.equal(db.values.size, 0);
  assert.equal(await reloaded.restoreNoteRecording('owner-a', stored.localRecordingId), undefined);
});

test('web persistence waits for transaction commit and an aborted write cannot report success', async () => {
  const db = indexedDBDouble(); db.autoCommit = false;
  const storage = load('web', null, webContext(db, []));
  let settled = false;
  const saved = storage.persistNoteRecording('owner', 'blob:temporary').then((value) => { settled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(db.values.size, 0);
  db.waiting.shift()();
  await saved;
  assert.equal(settled, true); assert.equal(db.values.size, 1);
  const failed = storage.persistNoteRecording('owner', 'blob:another');
  await new Promise((resolve) => setImmediate(resolve));
  db.waiting.shift()(true);
  await assert.rejects(failed, /Recording storage failed/);
  assert.equal(db.values.size, 1);
});

test('recording IDs and source URLs are excluded from uploaded media API payloads', () => {
  const { stripEditorMediaDrafts } = loadTsModule('src/features/notes/utils/note-media-upload.ts');
  const payload = stripEditorMediaDrafts([{ type: 'AUDIO', objectKey: 'notes/audio', clientId: 'recording:one', uploadStatus: 'UPLOADED',
    previewUri: 'blob:private', localRecordingId: 'recording-one.webm', sortOrder: 0 }]);
  const json = JSON.stringify(payload);
  assert.ok(!json.includes('localRecordingId') && !json.includes('blob:') && !json.includes('recording:'));
});
