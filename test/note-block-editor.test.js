const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test("NoteBlockEditor.dom.tsx has 'use dom' directive", () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /'use dom'/);
});

test('NoteBlockEditor.dom.tsx imports BlockNote React', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /@blocknote\/react/);
});

test('NoteBlockEditor.dom.tsx has onContentChange callback', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /onContentChange/);
});

test('NoteBlockEditor.dom.tsx has onImageRequest callback', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /onImageRequest/);
});

test('NoteBlockEditor.dom.tsx handles pendingInsert to insert image block', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /pendingInsert/);
  assert.match(src, /insertBlocks/);
});

test('Native NoteBlockEditor.tsx uses expo-image-picker', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /ImagePicker/);
  assert.match(src, /pendingInsert/);
});

test('Native NoteBlockEditor.tsx uploads via presign', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /requestUploadPresign/);
  assert.match(src, /notes/);
});

test('NoteBlockEditor.dom.tsx pins root to the WebView viewport (no collapsed height)', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  // Expo DOM mounts content with no html/body/#root height, so a height:100%
  // root collapses to content size. The root must fill the viewport instead.
  assert.match(src, /position:\s*'fixed'/);
  assert.match(src, /inset:\s*0/);
  assert.doesNotMatch(src, /height:\s*'100%'/);
});

test('NoteBlockEditor.dom.tsx localizes the editor via BlockNote dictionary', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /from '@blocknote\/core\/locales'/);
  assert.match(src, /dictionary:\s*language === 'zh' \? zh : en/);
});

test('NoteBlockEditor.dom.tsx image button uses an SVG icon, not a CJK glyph', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /<svg/);
  // The old '图' text label rendered as tofu on some WebView fonts.
  assert.doesNotMatch(src, /imageLabel/);
});

test('Native NoteBlockEditor.tsx forwards resolved language to the DOM editor', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /language=\{language\}/);
  assert.match(src, /startsWith\('zh'\)/);
});

test('DOM editor exposes a video toolbar button wired to onVideoRequest', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /onVideoRequest/);
  assert.match(src, /videoTitle/);
});

test('NoteBlockEditor can hide media toolbar buttons for structured note text sections', () => {
  const nativeSrc = read('src/features/notes/components/NoteBlockEditor.tsx');
  const domSrc = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');

  assert.match(nativeSrc, /mediaToolbarEnabled\?: boolean/);
  assert.match(nativeSrc, /mediaToolbarEnabled = true/);
  assert.match(nativeSrc, /mediaToolbarEnabled=\{mediaToolbarEnabled\}/);
  assert.match(domSrc, /mediaToolbarEnabled\?: boolean/);
  assert.match(domSrc, /mediaToolbarEnabled = true/);
  assert.match(domSrc, /mediaToolbarEnabled \? \(/);
});

test('DOM editor inserts the pending block by its type (image or video)', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /type: pendingInsert\.type/);
  assert.match(src, /type: 'image' \| 'video'/);
});

test('Native editor has a video request handler and uploads as VIDEO', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /handleVideoRequest/);
  assert.match(src, /pickUploadAndInsert\('video'\)/);
  assert.match(src, /mediaTypes: kind === 'video' \? \['videos'\] : \['images'\]/);
  assert.match(src, /onVideoRequest=\{handleVideoRequest\}/);
});

test('Native editor gives video uploads a longer timeout', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /VIDEO_UPLOAD_TIMEOUT_MS/);
});

test('extractMediaFromBlocks extracts video blocks as VIDEO media', () => {
  const src = read('src/features/notes/utils/note-blocks.ts');
  assert.match(src, /type !== 'image' && type !== 'video'/);
  assert.match(src, /type === 'video' \? 'VIDEO' : 'IMAGE'/);
  assert.match(src, /durationMs/);
});

test('upload helper accepts a configurable timeout', () => {
  const src = read('src/services/api/upload.ts');
  assert.match(src, /timeoutMs: number = UPLOAD_TIMEOUT_MS/);
});
