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
