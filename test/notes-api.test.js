/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('fetchNotes calls GET /note', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /fetchNotes/);
  assert.match(src, /\/note/);
});

test('fetchNotes exposes backend section summary flags used by shared note cards', () => {
  const typesSource = read('src/features/notes/types.ts');
  const payloadSource = read('src/features/chat/utils/note-card-payload.ts');

  assert.match(typesSource, /hasText\?: boolean/);
  assert.match(typesSource, /showcaseCount\?: number/);
  assert.match(typesSource, /hasLocation\?: boolean/);
  assert.match(payloadSource, /typeof note\.hasText === 'boolean'/);
  assert.match(payloadSource, /typeof note\.showcaseCount === 'number'/);
  assert.match(payloadSource, /typeof note\.hasLocation === 'boolean'/);
});

test('fetchNoteDetail calls GET /note/:id', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /fetchNoteDetail/);
  assert.match(src, /\/note\/\$\{id\}/);
});

test('createNote calls POST /note', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /createNote/);
  assert.match(src, /method.*POST/);
});

test('updateNote calls PATCH /note/:id', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /updateNote/);
  assert.match(src, /PATCH/);
});

test('togglePinNote calls PATCH /note/:id/pin', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /togglePinNote/);
  assert.match(src, /\/pin/);
});

test('unlistNote calls PATCH /note/:id/status with UNLISTED', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /unlistNote/);
  assert.match(src, /`\/note\/\$\{id\}\/status`/);
  assert.match(src, /method:\s*'PATCH'/);
  assert.match(src, /status:\s*'UNLISTED'/);
});

test('relistNote calls PATCH /note/:id/status with ACTIVE', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /relistNote/);
  assert.match(src, /`\/note\/\$\{id\}\/status`/);
  assert.match(src, /method:\s*'PATCH'/);
  assert.match(src, /status:\s*'ACTIVE'/);
});

test('createNoteShareLink posts the current notes view to /note/share-links', () => {
  const src = read('src/services/api/notes.ts');
  const typesSource = read('src/features/notes/types.ts');

  assert.match(typesSource, /CreateNoteShareLinkInput/);
  assert.match(typesSource, /NoteShareLink/);
  assert.match(src, /createNoteShareLink/);
  assert.match(src, /\/note\/share-links/);
  assert.match(src, /method:\s*'POST'/);
  assert.match(src, /body:\s*input/);
});

test('createNoteExport posts export requests to /note/:id/exports and returns downloadable metadata', () => {
  const src = read('src/services/api/notes.ts');
  const typesSource = read('src/features/notes/types.ts');

  assert.match(typesSource, /export type NoteExportFormat = 'IMAGE' \| 'PDF' \| 'IMAGES' \| 'VIDEOS'/);
  assert.match(typesSource, /interface CreateNoteExportInput/);
  assert.match(typesSource, /interface NoteExportResult/);
  assert.match(typesSource, /url: string/);
  assert.match(typesSource, /filename: string/);
  assert.match(typesSource, /mimeType: string/);
  assert.match(typesSource, /expiresAt: string \| null/);
  assert.match(src, /createNoteExport/);
  assert.match(src, /`\/note\/\$\{noteId\}\/exports`/);
  assert.match(src, /method:\s*'POST'/);
  assert.match(src, /body:\s*input/);
});

test('fetchNoteGroups calls GET /note/group', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /fetchNoteGroups/);
  assert.match(src, /\/note\/group/);
});

test('createNoteGroup calls POST /note/group', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /createNoteGroup/);
  assert.match(src, /\/note\/group/);
});

test('note types and api client use groups arrays and groupIds payloads', () => {
  const typesSource = read('src/features/notes/types.ts');
  const apiSource = read('src/services/api/notes.ts');

  assert.match(typesSource, /groups: \{ id: string; name: string \}\[]/);
  assert.match(typesSource, /groupIds\?: string\[]/);
  assert.doesNotMatch(typesSource, /group: \{ id: string; name: string \} \| null/);
  assert.match(apiSource, /groupIds/);
  assert.match(apiSource, /reorderNoteGroups/);
  assert.match(apiSource, /\/note\/group\/order/);
});

test('upload.ts allows notes folder', () => {
  const src = read('src/services/api/upload.ts');
  assert.match(src, /notes/);
});
