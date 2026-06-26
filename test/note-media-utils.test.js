const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {}, require };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('existing note media is indexed by URL so edits preserve object metadata', () => {
  const { buildNoteMediaMap } = loadTsModule('src/features/notes/utils/note-blocks.ts');

  const mediaMap = buildNoteMediaMap([
    {
      id: 'media-1',
      type: 'VIDEO',
      objectKey: 'notes/video.mp4',
      url: 'https://cdn.example.test/video.mp4',
      mimeType: 'video/mp4',
      size: 42,
      width: 1920,
      height: 1080,
      durationMs: 120000,
      posterUrl: null,
      sortOrder: 3,
    },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(mediaMap['https://cdn.example.test/video.mp4'])), {
    type: 'VIDEO',
    objectKey: 'notes/video.mp4',
    url: 'https://cdn.example.test/video.mp4',
    mimeType: 'video/mp4',
    size: 42,
    width: 1920,
    height: 1080,
    durationMs: 120000,
    sortOrder: 3,
  });
});

test('note video upload policy rejects videos that are too large or too long', () => {
  const {
    MAX_NOTE_VIDEO_BYTES,
    MAX_NOTE_VIDEO_DURATION_MS,
    getNoteVideoUploadPolicyViolation,
  } = loadTsModule('src/features/notes/utils/note-media-policy.ts');

  assert.equal(
    getNoteVideoUploadPolicyViolation({
      fileSize: MAX_NOTE_VIDEO_BYTES + 1,
      duration: 1000,
    }),
    'size',
  );
  assert.equal(
    getNoteVideoUploadPolicyViolation({
      fileSize: 1024,
      duration: MAX_NOTE_VIDEO_DURATION_MS + 1,
    }),
    'duration',
  );
  assert.equal(
    getNoteVideoUploadPolicyViolation({
      fileSize: MAX_NOTE_VIDEO_BYTES,
      duration: MAX_NOTE_VIDEO_DURATION_MS,
    }),
    null,
  );
});

test('media payload merge preserves known media and drops unmatched blocks without object keys', () => {
  const { mergeExtractedMediaWithMediaMap } = loadTsModule(
    'src/features/notes/utils/note-blocks.ts',
  );

  const merged = mergeExtractedMediaWithMediaMap(
    [
      {
        type: 'VIDEO',
        objectKey: '',
        url: 'https://cdn.example.test/video.mp4',
        sortOrder: 0,
      },
      {
        type: 'IMAGE',
        objectKey: '',
        url: 'https://external.example.test/image.jpg',
        sortOrder: 1,
      },
    ],
    {
      'https://cdn.example.test/video.mp4': {
        type: 'VIDEO',
        objectKey: 'notes/video.mp4',
        url: 'https://cdn.example.test/video.mp4',
        mimeType: 'video/mp4',
        sortOrder: 99,
      },
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(merged)), [
    {
      type: 'VIDEO',
      objectKey: 'notes/video.mp4',
      url: 'https://cdn.example.test/video.mp4',
      mimeType: 'video/mp4',
      sortOrder: 0,
    },
  ]);
});
