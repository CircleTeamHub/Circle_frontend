const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function noteModules(storage) {
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) cache.set(file, loadTsModule(file, {
      requireShim: (name) => {
        if (name === '@/storage') return { storage };
        if (name === 'react-native') return { Platform: { OS: 'web' } };
        if (name === '@/services/api/utils') return { normalizeMediaUrl: (url) => url };
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
        return require(name);
      },
    }));
    return cache.get(file);
  };
  return load;
}

test('document instances preserve interleaved text and independently owned image regions', () => {
  const load = noteModules();
  const { buildNoteSections } = load('src/features/notes/utils/note-sections.ts');
  const { buildNoteComposerBlocksMetadata } = load('src/features/notes/utils/note-composer.ts');
  const { getNoteDocumentInstances } = load('src/features/notes/utils/note-document-layout.ts');
  const paragraph = (text) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];
  const marker = buildNoteComposerBlocksMetadata(
    [{ id: 't1', kind: 'text' }, { id: 'i1', kind: 'image' }, { id: 't2', kind: 'text' }, { id: 'i2', kind: 'image' }],
    [{ id: 't1', content: paragraph('first') }, { id: 't2', content: paragraph('second') }],
    [{ id: 'i1', target: 'media', objectKeys: ['one'] }, { id: 'i2', target: 'media', objectKeys: ['two'] }],
  );
  const sections = buildNoteSections({ sections: {
    text: { content: 'first second', contentJson: [marker] },
    media: { items: ['one', 'two'].map((key) => ({ type: 'IMAGE', objectKey: key, url: 'https://cdn/' + key })) },
  } });
  const entries = getNoteDocumentInstances(sections, ['text', 'media'], [marker]);
  assert.equal(entries.map((entry) => entry.id).join(','), 't1,i1,t2,i2');
  assert.equal(entries[0].sections.text.content, 'first');
  assert.equal(entries[2].sections.text.content, 'second');
  assert.equal(entries[1].sections.media.items.map((item) => item.objectKey).join(','), 'one');
  assert.equal(entries[3].sections.media.items.map((item) => item.objectKey).join(','), 'two');
});

test('viewer includes nested inline images once without moving them out of their text block', () => {
  const load = noteModules();
  const { buildNoteSections, getNoteViewerImages, getNoteInlineMediaItems } = load('src/features/notes/utils/note-sections.ts');
  const image = { type: 'image', props: { url: 'https://cdn/nested', objectKey: 'nested' } };
  const sections = buildNoteSections({ contentJson: [{ type: 'paragraph', children: [image, image] }] });
  assert.equal(sections.media.items.length, 0);
  assert.equal(getNoteViewerImages(sections).length, 1);
  assert.equal(getNoteViewerImages(sections)[0].url, 'https://cdn/nested');
  let deep = image;
  for (let i = 0; i < 12; i += 1) deep = { type: 'paragraph', children: [deep] };
  assert.equal(getNoteInlineMediaItems([deep]).length, 0);
});

test('audio singleton normalization preserves repeatable text and image regions', () => {
  const load = noteModules();
  const { normalizeNoteComposerBlocks } = load('src/features/notes/utils/note-composer.ts');
  const normalized = normalizeNoteComposerBlocks([
    { id: 'a1', kind: 'audio' }, { id: 'a2', kind: 'audio' },
    { id: 't1', kind: 'text' }, { id: 't2', kind: 'text' },
  ], null, false);
  assert.equal(normalized.map((block) => block.id).join(','), 'a1,t1,t2');
});

test('draft index eviction removes only the evicted account payload', () => {
  const values = new Map();
  const storage = { getString: (key) => values.get(key), set: (key, value) => values.set(key, value), remove: (key) => values.delete(key) };
  const load = noteModules(storage);
  const { saveLocalNoteDraft, loadLocalNoteDraft, loadLocalNoteDraftSummaries } = load('src/features/notes/utils/note-editor-drafts.ts');
  const record = (id, updatedAt) => ({
    version: 1, id, noteId: null, title: '', content: '', contentJson: [], sections: {},
    groupIds: [], mediaKeys: [], composerBlocks: [], textBlocksById: {},
    mediaItems: [], showcaseItems: [], audioItems: [], mediaOwnerByClientId: {},
    contactItems: [], groupCardItems: [], location: { title: '', address: '', latitude: null, longitude: null },
    createdAt: 0, updatedAt,
  });
  saveLocalNoteDraft('other', record('d0', 0));
  for (let i = 0; i < 101; i += 1) saveLocalNoteDraft('me', record('d' + i, i));
  assert.equal(loadLocalNoteDraftSummaries('me').length, 100);
  assert.equal(loadLocalNoteDraft('me', 'd0'), null);
  assert.ok(loadLocalNoteDraft('other', 'd0'));
  assert.equal(loadLocalNoteDraftSummaries('me')[0].contentPreview, '');
});

test('image metadata remains aligned when an earlier item has no usable URL', () => {
  const { normalizeImageMedia } = noteModules()('src/services/api/image-media.ts');
  const normalized = normalizeImageMedia([], [{ key: 'missing' }, { key: 'visible', original: 'https://cdn/visible', width: 123 }]);
  assert.equal(normalized.images.join(','), 'https://cdn/visible');
  assert.equal(normalized.media.length, 1);
  assert.equal(normalized.media[0].key, 'visible');
  assert.equal(normalized.media[0].width, 123);
});
