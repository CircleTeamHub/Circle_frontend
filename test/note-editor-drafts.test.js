const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadDraftUtils(recordings = {}, storageOverride) {
  return loadTsModule('src/features/notes/utils/note-editor-drafts.ts', {
    requireShim: (request) => {
      if (request === '@/storage') {
        return {
          storage: storageOverride ?? {
            getString: () => undefined,
            set: () => undefined,
            remove: () => undefined,
          },
        };
      }
      if (request === '@/features/notes/utils/note-recording-storage') return {
        isNoteRecordingId: (id) => typeof id === 'string' && /^recording-[a-z0-9-]{1,80}\.(m4a|webm)$/.test(id),
        removeNoteRecording: async () => undefined,
        restoreNoteRecording: async () => undefined,
        ...recordings,
      };
      return require(request);
    },
  });
}

test('server draft payload strips local editor metadata from nested sections', () => {
  const { localDraftSummaryToServerInput } = loadDraftUtils();
  const input = localDraftSummaryToServerInput({
    title: 'draft',
    content: 'body',
    contentJson: [],
    groupIds: [],
    mediaKeys: ['notes/image.jpg'],
    noteId: null,
    sections: {
      media: {
        items: [
          {
            type: 'IMAGE',
            objectKey: 'notes/image.jpg',
            sortOrder: 0,
            clientId: 'local-client-id',
            uploadStatus: 'UPLOADED',
            previewUri: 'file:///private.jpg',
          },
        ],
      },
      contacts: {
        items: [
          {
            id: 'user-1',
            name: 'Alice',
            faceURL: 'https://cdn.example/avatar.jpg',
            avatarUrl: 'https://cdn.example/avatar.jpg',
            userId: 'user-1',
            subtitle: 'private local field',
          },
        ],
      },
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(input.sections)), {
    media: { items: [{ type: 'IMAGE', objectKey: 'notes/image.jpg', sortOrder: 0 }] },
    contacts: {
      items: [
        { id: 'user-1', name: 'Alice', faceURL: 'https://cdn.example/avatar.jpg' },
      ],
    },
  });
});

test('pending write metadata survives exit/restart locally and never enters the draft API DTO', () => {
  const utils = loadDraftUtils({}, memoryStorage());
  const pendingSubmission = { noteId: 'note', input: { title: 'Frozen', media: [], clientDraftID: 'd' } };
  utils.saveLocalNoteDraft('owner', { ...draft('d'), pendingSubmission });
  const restored = utils.loadLocalNoteDraft('owner', 'd');
  assert.deepEqual(JSON.parse(JSON.stringify(restored.pendingSubmission)), pendingSubmission);
  assert.equal(utils.loadLocalNoteDraft('other', 'd'), null);
  assert.ok(!JSON.stringify(utils.localDraftSummaryToServerInput(restored)).includes('pendingSubmission'));
});

test('refreshing local media preserves local layout/ownership and pending recording while replacing dead previews', () => {
  const utils = loadDraftUtils({}, memoryStorage());
  const image = { type: 'IMAGE', objectKey: 'notes/photo', clientId: 'local-image', uploadStatus: 'UPLOADED', previewUri: 'blob:revoked', sortOrder: 0 };
  const pending = audio('pending');
  const local = { ...draft('d', [pending]), title: 'Local', mediaItems: [image], showcaseItems: [{ ...image, clientId: 'local-showcase' }], composerBlocks: [{ id: 'image-region', kind: 'image' }], mediaOwnerByClientId: { 'local-image': 'image-region' } };
  const remote = { ...draft('d'), title: 'Remote', mediaItems: [{ ...image, url: 'https://fresh/image' }], showcaseItems: [{ ...image, url: 'https://fresh/showcase' }] };
  const refreshed = utils.refreshLocalNoteDraftMedia(local, remote);
  assert.equal(refreshed.title, 'Local'); assert.equal(refreshed.mediaItems[0].clientId, 'local-image');
  assert.equal(refreshed.mediaItems[0].previewUri, undefined); assert.equal(refreshed.mediaItems[0].url, 'https://fresh/image');
  assert.equal(refreshed.showcaseItems[0].url, 'https://fresh/showcase');
  assert.equal(refreshed.audioItems[0], pending); assert.equal(refreshed.composerBlocks, local.composerBlocks); assert.equal(refreshed.mediaOwnerByClientId, local.mediaOwnerByClientId);
  utils.saveLocalNoteDraft('owner', local);
  assert.ok(!JSON.stringify(utils.loadLocalNoteDraft('owner', 'd')).includes('blob:revoked'));
});

function draft(id, audioItems = [], updatedAt = 0) {
  return { version: 1, id, noteId: null, title: '', content: '', contentJson: [], sections: {}, groupIds: [], mediaKeys: [],
    composerBlocks: [], textBlocksById: {}, mediaItems: [], showcaseItems: [], audioItems, mediaOwnerByClientId: {}, contactItems: [], groupCardItems: [],
    location: { title: '', address: '', latitude: null, longitude: null }, createdAt: 0, updatedAt };
}
function audio(id, overrides = {}) {
  return { clientId: 'recording:' + id, type: 'AUDIO', objectKey: '', uploadStatus: 'PENDING', sortOrder: 0,
    localRecordingId: 'recording-' + id + '.m4a', previewUri: 'file:///old-container/recording-' + id + '.m4a', ...overrides };
}
function memoryStorage() {
  const values = new Map();
  return { values, getString: (key) => values.get(key), set: (key, value) => values.set(key, value), remove: (key) => values.delete(key) };
}

test('recorded audio stores only its relative ID and resolves a new container URI on hydration', async () => {
  const storage = memoryStorage();
  const utils = loadDraftUtils({ restoreNoteRecording: async (owner, id) => `file:///new-container/${owner}/${id}` }, storage);
  utils.saveLocalNoteDraft('owner', draft('d', [audio('one', { url: 'https://private.test/audio?signature=secret' })]));
  const json = [...storage.values.values()].join('');
  assert.ok(json.includes('recording-one.m4a'));
  assert.ok(!json.includes('file:///') && !json.includes('signature=secret'));
  const restored = await utils.restoreLocalNoteDraftRecordings('owner', utils.loadLocalNoteDraft('owner', 'd'));
  assert.equal(restored.audioItems[0].previewUri, 'file:///new-container/owner/recording-one.m4a');
});

test('a pending recording without durable storage cannot report a local save, but uploaded audio can', () => {
  const storage = memoryStorage();
  const utils = loadDraftUtils({}, storage);
  assert.throws(() => utils.saveLocalNoteDraft('owner', draft('d', [audio('one', { localRecordingId: undefined })])), /not been stored/);
  assert.throws(() => utils.saveLocalNoteDraft('owner', draft('d', [audio('one', { previewUri: undefined })])), /not been stored/);
  assert.doesNotThrow(() => utils.saveLocalNoteDraft('owner', draft('d', [audio('one', { localRecordingId: undefined, previewUri: undefined, uploadStatus: 'UPLOADED', objectKey: 'notes/audio' })])));
  utils.saveLocalNoteDraft('owner', draft('canonical', [audio('one', { uploadStatus: 'UPLOADED', objectKey: 'notes/audio', url: 'https://cdn.test/audio.m4a' })]));
  assert.equal(utils.loadLocalNoteDraft('owner', 'canonical').audioItems[0].url, 'https://cdn.test/audio.m4a');
  assert.equal(utils.loadLocalNoteDraft('owner', 'canonical').audioItems[0].previewUri, undefined);
});

test('draft replacement, removal and eviction clean recordings without deleting retained or other-account references', async () => {
  const removed = [];
  const utils = loadDraftUtils({ removeNoteRecording: async (...args) => removed.push(args) }, memoryStorage());
  utils.saveLocalNoteDraft('owner', draft('old', [audio('shared'), audio('obsolete')]));
  utils.saveLocalNoteDraft('other', draft('old', [audio('shared')]));
  utils.saveLocalNoteDraft('owner', draft('old', [audio('shared')]));
  assert.deepEqual(removed, [['owner', 'recording-obsolete.m4a']]);
  utils.saveLocalNoteDraft('owner', draft('retained', [audio('shared')]));
  utils.removeUnreferencedLocalNoteRecordings('owner', ['recording-shared.m4a'], 'old');
  assert.deepEqual(removed, [['owner', 'recording-obsolete.m4a']]);
  for (let i = 0; i < 99; i += 1) utils.saveLocalNoteDraft('owner', draft('d' + i, [], i));
  assert.equal(utils.loadLocalNoteDraft('owner', 'old'), null);
  assert.deepEqual(removed, [['owner', 'recording-obsolete.m4a']]);
  utils.removeLocalNoteDraft('owner', 'retained');
  assert.deepEqual(removed.at(-1), ['owner', 'recording-shared.m4a']);
  assert.ok(utils.loadLocalNoteDraft('other', 'old'));
  utils.removeAllLocalNoteDrafts('other');
  assert.deepEqual(removed.at(-1), ['other', 'recording-shared.m4a']);
});

test('missing durable files clear stale preview URIs while keeping the pending item removable', async () => {
  const utils = loadDraftUtils();
  const restored = await utils.restoreLocalNoteDraftRecordings('owner', draft('d', [audio('one')]));
  assert.equal(restored.audioItems.length, 1);
  assert.equal(restored.audioItems[0].previewUri, undefined);
  assert.equal(restored.audioItems[0].uploadStatus, 'PENDING');
});


test('offline deletion removes private content immediately and persists a restart-safe autosave fence', async () => {
  const store = memoryStorage(); const removed = [];
  const utils = loadDraftUtils({ removeNoteRecording: async (...args) => removed.push(args) }, store);
  utils.saveLocalNoteDraft('owner', { ...draft('deleted', [audio('one')]), title: 'Private title', content: 'Private body' });
  utils.saveLocalNoteDraft('other', draft('deleted', [audio('one')]));
  assert.equal(utils.stageLocalNoteDraftDeletion('owner', 'deleted'), true);
  assert.equal(utils.loadLocalNoteDraft('owner', 'deleted'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadLocalNoteDraftSummaries('owner'))), []);
  assert.ok(![...store.values.values()].join('').includes('Private'));
  assert.throws(() => utils.saveLocalNoteDraft('owner', draft('deleted')), /deleted/);
  assert.ok(utils.loadLocalNoteDraft('other', 'deleted'));
  const restarted = loadDraftUtils({ removeNoteRecording: async (...args) => removed.push(args) }, store);
  assert.equal(restarted.isLocalNoteDraftDeleted('owner', 'deleted'), true);
  assert.throws(() => restarted.saveLocalNoteDraft('owner', draft('deleted')), /deleted/);
  const cleanedRecordings = await restarted.finishLocalNoteDraftDeletion('owner', 'deleted');
  assert.deepEqual(removed, [['owner', 'recording-one.m4a']]);
  restarted.confirmNoteDraftDeletion('owner', 'deleted', cleanedRecordings);
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.loadPendingNoteDraftDeletions('owner'))), []);
  assert.throws(() => restarted.saveLocalNoteDraft('owner', draft('deleted')), /deleted/);
});

test('a latest publication recovery marker blocks deletion despite an older summary', () => {
  const store = memoryStorage(); const utils = loadDraftUtils({}, store);
  utils.saveLocalNoteDraft('owner', draft('pending'));
  utils.loadLocalNoteDraftSummaries('owner');
  const pendingSubmission = { noteId: null, input: { title: 'Original write', media: [], clientDraftID: 'pending' } };
  utils.saveLocalNoteDraft('owner', { ...draft('pending'), pendingSubmission });
  assert.equal(utils.stageLocalNoteDraftDeletion('owner', 'pending'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadLocalNoteDraft('owner', 'pending').pendingSubmission)), pendingSubmission);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadPendingNoteDraftDeletions('owner'))), []);
});

test('partial content or recording deletion stays retryable and never cleans a retained recording', async () => {
  const store = memoryStorage(); let failFiles = true; const removed = [];
  const utils = loadDraftUtils({ removeNoteRecording: async (...args) => { if (failFiles) throw new Error('disk unavailable'); removed.push(args); } }, store);
  utils.saveLocalNoteDraft('owner', draft('d', [audio('private'), audio('shared')]));
  utils.saveLocalNoteDraft('owner', draft('retained', [audio('shared')]));
  const remove = store.remove; store.remove = () => {};
  assert.throws(() => utils.stageLocalNoteDraftDeletion('owner', 'd'), /not removed/);
  assert.equal(utils.loadLocalNoteDraft('owner', 'd'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadPendingNoteDraftDeletions('owner'))), ['d']);
  store.remove = remove;
  await assert.rejects(utils.finishLocalNoteDraftDeletion('owner', 'd'), /disk unavailable/);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadPendingNoteDraftDeletions('owner'))), ['d']);
  failFiles = false;
  const earlyCleanup = await utils.finishLocalNoteDraftDeletion('owner', 'd');
  utils.retainDeletedNoteDraftRecording('owner', 'd', 'recording-late-copy.m4a');
  assert.equal(utils.confirmNoteDraftDeletion('owner', 'd', earlyCleanup), false);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadPendingNoteDraftDeletions('owner'))), ['d']);
  const finalCleanup = await utils.finishLocalNoteDraftDeletion('owner', 'd');
  assert.ok(removed.some(([, id]) => id === 'recording-late-copy.m4a'));
  assert.ok(!removed.some(([, id]) => id === 'recording-shared.m4a'));
  utils.confirmNoteDraftDeletion('owner', 'd', finalCleanup);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadPendingNoteDraftDeletions('owner'))), []);
});

test('failure to persist the delete intent leaves the original local content intact', () => {
  const store = memoryStorage(); const utils = loadDraftUtils({}, store);
  utils.saveLocalNoteDraft('owner', { ...draft('d'), title: 'Keep private draft' });
  const set = store.set; store.set = () => {};
  assert.throws(() => utils.stageLocalNoteDraftDeletion('owner', 'd'), /not stored/);
  store.set = set;
  assert.equal(utils.loadLocalNoteDraft('owner', 'd').title, 'Keep private draft');
});
