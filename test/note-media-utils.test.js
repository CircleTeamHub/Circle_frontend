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

test('showcase images migrate to ordinary media while showcase keeps only videos', () => {
  const { buildNoteSections } = loadTsModule('src/features/notes/utils/note-sections.ts');

  const showcaseImage = {
    id: 'showcase-1',
    type: 'IMAGE',
    objectKey: 'notes/showcase.jpg',
    url: 'https://cdn.example.test/showcase.jpg',
    mimeType: 'image/jpeg',
    sortOrder: 0,
  };

  const sections = buildNoteSections({
    content: '',
    contentJson: [],
    media: [],
    sections: {
      text: { content: '', contentJson: [] },
      media: { items: [] },
      showcase: {
        items: [
          showcaseImage,
          {
            id: 'showcase-video',
            type: 'VIDEO',
            objectKey: 'notes/showcase.mp4',
            url: 'https://cdn.example.test/showcase.mp4',
            mimeType: 'video/mp4',
            durationMs: 4200,
            sortOrder: 9,
          },
        ],
      },
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(sections.media.items)), [
    { ...showcaseImage, sortOrder: 0 },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sections.showcase.items.map((item) => item.url))),
    ['https://cdn.example.test/showcase.mp4'],
  );
  assert.equal(sections.showcase.items[0].sortOrder, 0);
});

test('normalization migrates legacy showcase images, dedupes by durable identity, and preserves metadata', () => {
  const { normalizeNoteMediaSections } = loadTsModule(
    'src/features/notes/utils/note-sections.ts',
  );

  const image = {
    id: 'legacy-showcase-image',
    type: 'IMAGE',
    objectKey: 'notes/same-image.jpg',
    url: 'https://cdn.example.test/same-image.jpg',
    mimeType: 'image/jpeg',
    size: 42,
    width: 640,
    height: 480,
    posterUrl: 'https://cdn.example.test/same-image-poster.jpg',
    sortOrder: 99,
  };

  const sections = normalizeNoteMediaSections({
    media: [
      { ...image, id: 'ordinary-image', sortOrder: 8 },
      {
        id: 'ordinary-video',
        type: 'VIDEO',
        objectKey: 'notes/ordinary.mp4',
        url: 'https://cdn.example.test/ordinary.mp4',
        mimeType: 'video/mp4',
        durationMs: 4000,
        sortOrder: 2,
      },
    ],
    showcase: [
      image,
      { ...image, id: 'same-file-with-new-url', url: 'https://signed.example.test/same-image.jpg' },
      {
        id: 'showcase-video',
        type: 'VIDEO',
        objectKey: 'notes/showcase.mp4',
        url: 'https://cdn.example.test/showcase.mp4',
        mimeType: 'video/mp4',
        durationMs: 7000,
        sortOrder: 77,
      },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(sections.media)), [
    { ...image, id: 'ordinary-image', sortOrder: 0 },
    {
      id: 'ordinary-video',
      type: 'VIDEO',
      objectKey: 'notes/ordinary.mp4',
      url: 'https://cdn.example.test/ordinary.mp4',
      mimeType: 'video/mp4',
      durationMs: 4000,
      sortOrder: 1,
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sections.showcase)), [
    {
      id: 'showcase-video',
      type: 'VIDEO',
      objectKey: 'notes/showcase.mp4',
      url: 'https://cdn.example.test/showcase.mp4',
      mimeType: 'video/mp4',
      durationMs: 7000,
      sortOrder: 0,
    },
  ]);
});

test('partial structured sections retain missing legacy media while explicit empty media stays authoritative', () => {
  const { buildNoteSections } = loadTsModule('src/features/notes/utils/note-sections.ts');
  const image = {
    id: 'legacy-image',
    type: 'IMAGE',
    objectKey: 'notes/legacy.jpg',
    url: 'https://cdn.example.test/legacy.jpg',
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
    sortOrder: 4,
  };

  const missingMedia = buildNoteSections({
    contentJson: [
      { type: 'image', props: { url: image.url } },
      { type: 'image', props: { url: 'https://legacy.example.test/inline-only.jpg' } },
    ],
    media: [image],
    sections: {
      showcase: {
        items: [{ type: 'VIDEO', url: 'https://cdn.example.test/showcase.mp4' }],
      },
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(missingMedia.media.items)), [
    { ...image, sortOrder: 0 },
    {
      id: 'image-1',
      type: 'IMAGE',
      url: 'https://legacy.example.test/inline-only.jpg',
      sortOrder: 1,
    },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(missingMedia.showcase.items.map((item) => item.type))),
    ['VIDEO'],
  );

  const explicitEmptyMedia = buildNoteSections({
    contentJson: [
      { type: 'image', props: { url: image.url } },
      { type: 'image', props: { url: 'https://legacy.example.test/inline-only.jpg' } },
    ],
    media: [image],
    sections: {
      media: { items: [] },
      showcase: {
        items: [{ type: 'VIDEO', url: 'https://cdn.example.test/showcase.mp4' }],
      },
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(explicitEmptyMedia.media.items)), []);
});

test('normalization joins object-key and URL aliases while unioning duplicate metadata', () => {
  const { normalizeNoteMediaSections } = loadTsModule(
    'src/features/notes/utils/note-sections.ts',
  );

  const sections = normalizeNoteMediaSections({
    media: [
      {
        id: 'ordinary',
        type: 'IMAGE',
        objectKey: 'notes/photo.jpg',
        url: 'https://cdn.example.test/photo.jpg',
        mimeType: 'image/jpeg',
      },
    ],
    showcase: [
      {
        type: 'IMAGE',
        url: 'https://cdn.example.test/photo.jpg',
        width: 640,
        height: 480,
        size: 42,
        posterUrl: 'https://cdn.example.test/poster.jpg',
      },
      {
        type: 'IMAGE',
        objectKey: 'notes/photo.jpg',
        url: 'https://signed.example.test/photo.jpg',
        durationMs: 123,
      },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(sections.media)), [
    {
      id: 'ordinary',
      type: 'IMAGE',
      objectKey: 'notes/photo.jpg',
      url: 'https://cdn.example.test/photo.jpg',
      mimeType: 'image/jpeg',
      width: 640,
      height: 480,
      size: 42,
      posterUrl: 'https://cdn.example.test/poster.jpg',
      durationMs: 123,
      sortOrder: 0,
    },
  ]);
});

test('normalization merges transitive key and renewed-URL aliases in either order', () => {
  const { normalizeNoteMediaSections } = loadTsModule(
    'src/features/notes/utils/note-sections.ts',
  );
  const old = {
    id: 'ordinary',
    type: 'IMAGE',
    objectKey: 'notes/photo.jpg',
    url: 'https://cdn.example.test/photo-old.jpg',
    mimeType: 'image/jpeg',
  };
  const keyedRenewed = {
    type: 'IMAGE',
    objectKey: 'notes/photo.jpg',
    url: 'https://signed.example.test/photo-new.jpg',
    width: 640,
    posterUrl: 'https://cdn.example.test/poster.jpg',
  };
  const urlOnlyRenewed = {
    type: 'IMAGE',
    url: 'https://signed.example.test/photo-new.jpg',
    height: 480,
    durationMs: 123,
  };

  for (const showcase of [
    [keyedRenewed, urlOnlyRenewed],
    [urlOnlyRenewed, keyedRenewed],
  ]) {
    const sections = normalizeNoteMediaSections({ media: [old], showcase });
    assert.deepEqual(JSON.parse(JSON.stringify(sections.media)), [
      {
        ...old,
        width: 640,
        height: 480,
        posterUrl: 'https://cdn.example.test/poster.jpg',
        durationMs: 123,
        sortOrder: 0,
      },
    ]);
  }
});
