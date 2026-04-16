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

test('deleteNote calls DELETE /note/:id', () => {
  const src = read('src/services/api/notes.ts');
  assert.match(src, /deleteNote/);
  assert.match(src, /DELETE/);
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
