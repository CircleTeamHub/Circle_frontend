const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function loadNoteMediaUpload() {
  const filePath = path.join(process.cwd(), 'src/features/notes/utils/note-media-upload.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

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
  const uploadSrc = read('src/features/notes/utils/note-media-upload.ts');
  assert.match(src, /buildPendingEditorBlocks\(pendingInserts\)/);
  assert.match(uploadSrc, /type: pendingInsert\.type/);
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

test('Native editor supports bounded multi-selection for standalone media insertion', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /allowsMultipleSelection:\s*true/);
  assert.match(src, /selectionLimit:\s*MAX_NOTE_MEDIA_SELECTION/);
  assert.match(src, /splitPickerAssets/);
  assert.match(src, /overflowAssets/);
  assert.match(src, /selectionLimitExceededMessage/);
  assert.match(src, /createPickerPreviewDisposer/);
  assert.match(src, /uploadNoteMediaBatch/);
  assert.match(src, /orderedSelection:\s*true/);
});

test('DOM insertion seam inserts a successful picker batch in picker order', () => {
  const { buildPendingEditorBlocks } = loadNoteMediaUpload();
  const blocks = buildPendingEditorBlocks(
    [
      { type: 'image', url: 'A', objectKey: 'a' },
      { type: 'image', url: 'B', objectKey: 'b' },
      { type: 'video', url: 'C', objectKey: 'c' },
    ],
  );
  assert.deepEqual(
    blocks.map((block) => block.props.url),
    ['A', 'B', 'C'],
  );
  assert.match(read('src/features/notes/dom/NoteBlockEditor.dom.tsx'), /insertBlocks\(\s*buildPendingEditorBlocks\(pendingInserts\)/);
});

test('DOM formatting actions ignore a missing cursor block', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /function applyType[\s\S]*?if \(!pos\?\.block\) return/);
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

// 作者往往直接点工具栏的图片按钮，从没在正文里点过一下 —— 那时没有文字光标。
// 原来 insertPendingMedia 直接 return，而调用方紧接着就 onInsertHandled() 把这批
// 交割掉：图已经传完、流量已经付过，却一张都没进文档，也没有任何提示。
test('没有文字光标时把媒体锚到文末，而不是丢掉这一批', () => {
  const { resolveMediaInsertAnchor } = loadNoteMediaUpload();

  assert.equal(resolveMediaInsertAnchor(undefined, ['a', 'b', 'last']), 'last');
  assert.equal(resolveMediaInsertAnchor(null, ['only']), 'only');
});

test('有文字光标时仍然锚在光标所在块，插在它后面', () => {
  const { resolveMediaInsertAnchor } = loadNoteMediaUpload();

  assert.equal(resolveMediaInsertAnchor('cursor', ['a', 'b', 'last']), 'cursor');
});

test('文档一个块都没有时给出 null，让调用方自己决定怎么处理', () => {
  const { resolveMediaInsertAnchor } = loadNoteMediaUpload();

  assert.equal(resolveMediaInsertAnchor(undefined, []), null);
});

test('插入用的是解析出来的锚点，而不是「没光标就返回」', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  const start = src.indexOf('function insertPendingMedia(');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n}', start));

  assert.match(body, /resolveMediaInsertAnchor\(/);
  assert.doesNotMatch(body, /if \(!pos\?\.block\) return;/);
  // 无论插没插成，这批都必须交割掉：留着不消费只会让 effect 依赖不变、
  // 永远不再触发，等于换一种方式卡死。
  const effect = src.slice(src.indexOf('if (pendingInserts.length === 0'));
  assert.match(effect.slice(0, 600), /onInsertHandled\(\);/);
});
