const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { loadTsModule: loadAliasedTsModule } = require('./helpers/load-ts-module');

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

// note-text-stats.ts 里有一条 `@/...` 别名 import，node --test 解析不了，走共享
// helper 的 requireShim 把它指回同一棵源码树。
function loadNoteTextStatsModule() {
  return loadAliasedTsModule('src/features/notes/utils/note-text-stats.ts', {
    requireShim: (specifier) =>
      specifier === '@/features/notes/utils/note-blocks'
        ? loadTsModule('src/features/notes/utils/note-blocks.ts')
        : require(specifier),
  });
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

// 笔记侧的视频上限一旦超过上传链路的上限，超出的那一段会先通过本地策略校验、
// 变成 PENDING 草稿，再在 presign 阶段被拒；批量上传只回传失败条数，用户看到的
// 是「N 个文件上传失败」，拿不到「文件太大」这个真正的原因。
test('note video size cap never exceeds the upload pipeline cap', () => {
  const { MAX_NOTE_VIDEO_BYTES } = loadTsModule(
    'src/features/notes/utils/note-media-policy.ts',
  );
  const uploadSource = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/upload.ts'),
    'utf8',
  );
  const match = uploadSource.match(
    /const MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024;/,
  );
  assert.ok(match, 'MAX_UPLOAD_BYTES literal not found in upload.ts');
  const maxUploadBytes = Number(match[1]) * 1024 * 1024;
  assert.ok(
    MAX_NOTE_VIDEO_BYTES <= maxUploadBytes,
    `MAX_NOTE_VIDEO_BYTES (${MAX_NOTE_VIDEO_BYTES}) exceeds MAX_UPLOAD_BYTES (${maxUploadBytes})`,
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

test('plain text retains pasted links, nested lists, code and table cell text', () => {
  const { extractPlainText } = loadTsModule('src/features/notes/utils/note-blocks.ts');
  const text = extractPlainText([
    {
      type: 'bulletListItem',
      content: [{ type: 'text', text: '主项' }, { type: 'link', content: [{ text: '链接文字' }] }],
      children: [{ type: 'checkListItem', content: [{ text: '子项' }], children: [null] }],
    },
    { type: 'codeBlock', content: [{ text: 'const answer = 42;' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ text: '旧格式单元格' }], { type: 'tableCell', content: [{ text: '新格式单元格' }] }] },
    ] } },
  ]);
  assert.equal(text, '主项链接文字\n子项\nconst answer = 42;\n旧格式单元格\t新格式单元格');
});

test('plain text extraction bounds nested server-provided blocks', () => {
  const { extractPlainText } = loadTsModule('src/features/notes/utils/note-blocks.ts');
  const root = { type: 'paragraph', content: [{ text: '第0层' }] };
  let parent = root;
  for (let depth = 1; depth <= 11; depth += 1) {
    const child = { type: 'paragraph', content: [{ text: `第${depth}层` }] };
    parent.children = [child];
    parent = child;
  }

  const text = extractPlainText([root]);

  assert.match(text, /第10层/);
  assert.doesNotMatch(text, /第11层/);
});

// 字数统计量的就是这段拼接结果（块间补一个换行），所以它跟后端 @MaxLength 校验的
// 是同一个字符串；按 code point 数，与 class-validator 的 Length 一致。
test('note text stats count the joined body the backend validates, by code point', () => {
  const { getNoteTextStats, getNoteTextLimitKind, MAX_NOTE_TEXT_LENGTH, MAX_NOTE_TEXT_BLOCKS } =
    loadNoteTextStatsModule();

  const twoBlocks = [
    { type: 'paragraph', content: [{ text: 'ab' }] },
    { type: 'paragraph', content: [{ text: 'cd' }] },
  ];
  // 4 个字 + 1 个块间换行 = 5，不是 4：文案说的是「正文长度」而不是「已输入字符」。
  // vm 里造出来的对象换了 realm，deepEqual 会卡在原型比对上，所以展开到本地对象再比。
  assert.deepEqual({ ...getNoteTextStats(twoBlocks) }, { characters: 5, blocks: 2 });
  // 代理对（emoji）按一个 code point 算，和后端一样。
  assert.equal(
    getNoteTextStats([{ type: 'paragraph', content: [{ text: '👩‍🚀' }] }]).characters,
    3,
  );

  assert.equal(getNoteTextLimitKind({ characters: MAX_NOTE_TEXT_LENGTH, blocks: 1 }), null);
  assert.equal(
    getNoteTextLimitKind({ characters: MAX_NOTE_TEXT_LENGTH + 1, blocks: 1 }),
    'textTooLong',
  );
  assert.equal(getNoteTextLimitKind({ characters: 1, blocks: MAX_NOTE_TEXT_BLOCKS }), null);
  assert.equal(
    getNoteTextLimitKind({ characters: 1, blocks: MAX_NOTE_TEXT_BLOCKS + 1 }),
    'tooManyParagraphs',
  );
});

// useSyncExternalStore 要求数据没变时 getSnapshot 返回同一个引用，否则每次读取都被
// 当成一次变更 —— 那样「不再整屏重渲染」这件事就白做了。
test('the note text stats store only notifies when the snapshot really changed', () => {
  const { createNoteTextStatsStore } = loadNoteTextStatsModule();
  const store = createNoteTextStatsStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  const first = store.getSnapshot();
  store.setBlocks([{ type: 'paragraph', content: [{ text: '一二' }] }]);
  assert.deepEqual({ ...store.getSnapshot() }, { characters: 2, blocks: 1 });
  assert.equal(notifications, 1);

  const second = store.getSnapshot();
  store.setBlocks([{ type: 'paragraph', content: [{ text: '三四' }] }]);
  assert.equal(notifications, 1, '字数和段数都没变就不该通知');
  assert.equal(store.getSnapshot(), second, '快照没变必须返回同一个引用');

  store.reset();
  assert.equal(notifications, 2);
  assert.equal(store.getSnapshot(), first, 'reset 要回到最初那个空快照');

  unsubscribe();
  store.setBlocks([{ type: 'paragraph', content: [{ text: '退订之后' }] }]);
  assert.equal(notifications, 2);
});
