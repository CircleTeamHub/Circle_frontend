const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }
      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

function comment(id, createdAt, replyToId = null, nickname = id) {
  return {
    id,
    content: `${id} content`,
    user: { id: `${id}-user`, nickname },
    replyTo: replyToId ? { id: replyToId, nickname: `user-${replyToId}` } : null,
    createdAt,
  };
}

test('buildMomentCommentThreads groups replies under top-level comments in chronological order', () => {
  const { buildMomentCommentThreads } = loadTsModule(
    'src/features/discover/utils/moment-comments.ts',
  );

  const threads = buildMomentCommentThreads([
    comment('reply-late', '2026-06-22T10:05:00.000Z', 'root-new'),
    comment('root-new', '2026-06-22T10:03:00.000Z'),
    comment('reply-to-reply', '2026-06-22T10:06:00.000Z', 'reply-late'),
    comment('orphan', '2026-06-22T10:01:00.000Z', 'missing-parent'),
    comment('root-old', '2026-06-22T10:00:00.000Z'),
    comment('reply-early', '2026-06-22T10:04:00.000Z', 'root-new'),
  ]);

  assert.deepEqual(
    Array.from(threads, (thread) => thread.comment.id),
    ['root-old', 'orphan', 'root-new'],
  );
  assert.deepEqual(
    Array.from(threads[2].replies, (reply) => reply.id),
    ['reply-early', 'reply-late', 'reply-to-reply'],
  );
  assert.equal(threads[1].comment.replyTo.id, 'missing-parent');
});

test('getPreviewMomentCommentThreads limits comment previews to four rows', () => {
  const {
    buildMomentCommentThreads,
    countMomentCommentRows,
    getPreviewMomentCommentThreads,
  } = loadTsModule('src/features/discover/utils/moment-comments.ts');

  const threads = buildMomentCommentThreads([
    comment('root-1', '2026-06-22T10:00:00.000Z'),
    comment('reply-1', '2026-06-22T10:01:00.000Z', 'root-1'),
    comment('reply-2', '2026-06-22T10:02:00.000Z', 'root-1'),
    comment('root-2', '2026-06-22T10:03:00.000Z'),
    comment('reply-3', '2026-06-22T10:04:00.000Z', 'root-2'),
    comment('root-3', '2026-06-22T10:05:00.000Z'),
  ]);

  const collapsed = getPreviewMomentCommentThreads(threads);

  assert.equal(countMomentCommentRows(threads), 6);
  assert.equal(countMomentCommentRows(collapsed), 4);
  assert.deepEqual(
    Array.from(collapsed, (thread) => [
      thread.comment.id,
      Array.from(thread.replies, (reply) => reply.id),
    ]),
    [
      ['root-1', ['reply-1', 'reply-2']],
      ['root-2', []],
    ],
  );
});

test('getMomentCommentPreviewState uses the backend total when feed only includes a preview subset', () => {
  const {
    buildMomentCommentThreads,
    countMomentCommentRows,
    getMomentCommentPreviewState,
  } = loadTsModule('src/features/discover/utils/moment-comments.ts');

  const threads = buildMomentCommentThreads([
    comment('root-1', '2026-06-22T10:00:00.000Z'),
    comment('reply-1', '2026-06-22T10:01:00.000Z', 'root-1'),
    comment('root-2', '2026-06-22T10:02:00.000Z'),
  ]);

  const preview = getMomentCommentPreviewState(threads, 20);

  assert.equal(countMomentCommentRows(preview.visibleThreads), 3);
  assert.equal(preview.hiddenCount, 17);
});

test('flattenMomentCommentThreads returns row-level comment data for virtualized detail lists', () => {
  const {
    buildMomentCommentThreads,
    flattenMomentCommentThreads,
  } = loadTsModule('src/features/discover/utils/moment-comments.ts');

  const threads = buildMomentCommentThreads([
    comment('root-1', '2026-06-22T10:00:00.000Z'),
    comment('reply-1', '2026-06-22T10:01:00.000Z', 'root-1'),
    comment('reply-2', '2026-06-22T10:02:00.000Z', 'reply-1'),
    comment('root-2', '2026-06-22T10:03:00.000Z'),
  ]);

  assert.deepEqual(
    flattenMomentCommentThreads(threads).map((row) => ({
      id: row.id,
      commentId: row.comment.id,
      isReply: row.isReply,
    })),
    [
      { id: 'root-1', commentId: 'root-1', isReply: false },
      { id: 'reply-1', commentId: 'reply-1', isReply: true },
      { id: 'reply-2', commentId: 'reply-2', isReply: true },
      { id: 'root-2', commentId: 'root-2', isReply: false },
    ],
  );
});

test('buildLikedFriendsPreview caps names and returns locale-aware separators', () => {
  const { buildLikedFriendsPreview } = loadTsModule(
    'src/features/discover/utils/moment-comments.ts',
  );
  const friends = [
    { id: '1', nickname: 'Alice' },
    { id: '2', nickname: 'Bob' },
    { id: '3', nickname: 'Chen' },
    { id: '4', nickname: 'Dana' },
  ];

  const enPreview = buildLikedFriendsPreview(friends, 'en-US');
  assert.equal(enPreview.namesText, 'Alice, Bob, Chen');
  assert.equal(enPreview.hiddenCount, 1);
  assert.equal(enPreview.separator, ', ');

  const zhPreview = buildLikedFriendsPreview(friends, 'zh-CN');
  assert.equal(zhPreview.namesText, 'Alice、Bob、Chen');
  assert.equal(zhPreview.hiddenCount, 1);
  assert.equal(zhPreview.separator, '、');
});

test('Moment screens wire preview helpers into list and detail rendering', () => {
  const cardSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/components/moment-card.tsx'),
    'utf8',
  );
  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/screens/MomentDetailScreen.tsx'),
    'utf8',
  );

  assert.match(cardSrc, /buildMomentCommentThreads/);
  assert.match(cardSrc, /getMomentCommentPreviewState/);
  assert.match(cardSrc, /thread\.replies\.map/);
  assert.match(cardSrc, /moment\.showMoreComments/);
  assert.doesNotMatch(cardSrc, /setShowAllComments/);

  assert.match(detailSrc, /flattenMomentCommentThreads/);
  assert.match(detailSrc, /commentRows/);
  assert.doesNotMatch(detailSrc, /thread\.replies\.map/);
  assert.doesNotMatch(detailSrc, /data=\{post\.comments\}/);
});

test('Moment detail refreshes full detail data and renders dividers outside row layout', () => {
  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/screens/MomentDetailScreen.tsx'),
    'utf8',
  );

  assert.match(detailSrc, /fetchMomentById\(id\)/);
  assert.doesNotMatch(detailSrc, /if\s*\(\s*post\s*\|\|\s*!id\s*\)/);
  assert.match(detailSrc, /post\.commentCount > 0/);
  assert.doesNotMatch(detailSrc, /post\.comments\.length > 0 \? t\('moment\.commentsCount'/);
  assert.match(detailSrc, /<View>\s*<(?:View|Pressable)\s*[\s\S]*style=\{\[s\.commentItem, item\.isReply \? s\.replyItem : null\]\}[\s\S]*<\/(?:View|Pressable)>\s*<Divider \/>\s*<\/View>/);
});

test('Moment detail supports pull-to-refresh', () => {
  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/screens/MomentDetailScreen.tsx'),
    'utf8',
  );

  assert.match(detailSrc, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(detailSrc, /handleRefreshMoment/);
  assert.match(detailSrc, /refreshInFlightRef/);
  assert.match(detailSrc, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(detailSrc, /setRefreshing\(true\)/);
  assert.match(detailSrc, /await loadMoment\(\)/);
  assert.match(detailSrc, /finally\s*\{[\s\S]{0,80}setRefreshing\(false\)/);
  assert.match(detailSrc, /refreshing=\{refreshing\}/);
  assert.match(detailSrc, /onRefresh=\{handleRefreshMoment\}/);
});

test('Moment detail surfaces background refresh failures when preview data is visible', () => {
  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/screens/MomentDetailScreen.tsx'),
    'utf8',
  );

  assert.match(detailSrc, /loadError && post \?/);
  assert.match(detailSrc, /moment\.detailRefreshFailed/);
  assert.match(detailSrc, /onPress=\{loadMoment\}/);
});
