const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withNativeStorageStubs } = require('./helpers/native-storage-stubs');

function loadMomentsApi(apiClient) {
  const filePath = path.join(process.cwd(), 'src/services/api/moments.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: withNativeStorageStubs((specifier) => {
      if (specifier === '@/services/api/client') return { apiClient };
      if (specifier === '@/services/api/utils') {
        return {
          buildQuery: () => '',
          normalizeMediaUrl: (value) => value,
          allowPeerMediaUrl: (value) => value,
          normalizeUserAvatarFrameAppearance: () => null,
        };
      }
      if (specifier === './image-media') {
        return {
          normalizeImageMedia: (imagesValue) => ({
            images: Array.isArray(imagesValue)
              ? imagesValue.filter((value) => typeof value === 'string')
              : [],
            media: [],
          }),
        };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const commentResponse = (overrides = {}) => ({
  id: 'comment-1',
  content: 'hello',
  images: [],
  user: { id: 'me', nickname: 'Me' },
  replyTo: null,
  createdAt: '2026-07-10T00:00:00.000Z',
  ignoredMentionCount: 0,
  ...overrides,
});

test('addMomentComment includes non-empty mentioned user ids', async () => {
  const calls = [];
  const { addMomentComment } = loadMomentsApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return commentResponse();
  });

  await addMomentComment('trace-1', {
    content: '@Alice hello',
    mentionedUserIds: ['alice-id'],
  }, { idempotencyKey: 'k' });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), {
    content: '@Alice hello',
    mentionedUserIds: ['alice-id'],
  }, { idempotencyKey: 'k' });
});

test('addMomentComment omits an empty mentioned user id list', async () => {
  const calls = [];
  const { addMomentComment } = loadMomentsApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return commentResponse();
  });

  await addMomentComment('trace-1', {
    content: 'hello',
    mentionedUserIds: [],
  }, { idempotencyKey: 'k' });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), {
    content: 'hello',
  });
});

test('addMomentComment normalizes ignoredMentionCount on the created comment', async () => {
  const { addMomentComment } = loadMomentsApi(async () =>
    commentResponse({ content: '@Alice hello', ignoredMentionCount: 2 }),
  );

  const comment = await addMomentComment('trace-1', {
    content: '@Alice hello',
    mentionedUserIds: ['alice-id'],
  }, { idempotencyKey: 'k' });

  assert.equal(comment.ignoredMentionCount, 2);
});

test('moment comment normalization defaults a missing ignored count to zero', () => {
  const { normalizeMomentComment } = loadMomentsApi(async () => {});

  assert.equal(
    normalizeMomentComment(
      commentResponse({ ignoredMentionCount: undefined }),
    ).ignoredMentionCount,
    0,
  );
});

test('moment comment success flows add the comment before warning about ignored mentions', () => {
  const feed = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/components/moments-feed.tsx'),
    'utf8',
  );
  const detail = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/screens/MomentDetailScreen.tsx'),
    'utf8',
  );

  assert.match(
    feed,
    /storeAddComment\(target\.momentId, comment\)[\s\S]*comment\.ignoredMentionCount > 0[\s\S]*setMentionNotice\([\s\S]*moment\.mentionsIgnored/,
  );
  assert.match(
    detail,
    /storeAddComment\(post\.id, comment\)[\s\S]*comment\.ignoredMentionCount > 0[\s\S]*setMentionNotice\([\s\S]*moment\.mentionsIgnored/,
  );
  assert.doesNotMatch(feed, /ignoredMentionCount > 0\) \{\s*Alert\.alert/);
  assert.doesNotMatch(detail, /ignoredMentionCount > 0\) \{\s*Alert\.alert/);
});

test('all locales define the ignored moment mention notice', () => {
  for (const locale of ['en', 'es', 'ja', 'ko', 'zh']) {
    const messages = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${locale}.json`),
        'utf8',
      ),
    );
    assert.equal(typeof messages.moment.mentionsIgnored, 'string', locale);
  }
});

test('all locales define the moment mention limit message', () => {
  for (const locale of ['en', 'es', 'ja', 'ko', 'zh']) {
    const messages = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${locale}.json`),
        'utf8',
      ),
    );
    assert.equal(typeof messages.moment.mentionLimit, 'string', locale);
  }
});

test('comment composer and both parents forward active mention ids', () => {
  const input = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/components/moment-comment-input.tsx'),
    'utf8',
  );
  const feed = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/components/moments-feed.tsx'),
    'utf8',
  );
  const detail = fs.readFileSync(
    path.join(process.cwd(), 'src/features/discover/screens/MomentDetailScreen.tsx'),
    'utf8',
  );

  assert.match(input, /onSubmit\(trimmed, replyTo\?\.id, images, mentionedUserIds\)/);
  assert.match(feed, /const input = \{ content, replyToId, images, mentionedUserIds \};/);
  assert.match(feed, /addMomentComment\(target\.momentId, input, \{ idempotencyKey \}\)/);
  assert.match(detail, /const input = \{ content, replyToId, images, mentionedUserIds \};/);
  assert.match(detail, /addMomentComment\(post\.id, input, \{ idempotencyKey \}\)/);
});

test('createMoment and addMomentComment send the caller\'s Idempotency-Key', async () => {
  const calls = [];
  const { addMomentComment, createMoment } = loadMomentsApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return endpoint === '/trace'
      ? { id: 'm1', images: [], attachments: [], comments: [], author: { id: 'me', avatarUrl: null } }
      : commentResponse();
  });

  await createMoment({ content: 'hi', images: [], attachments: [], visibility: 'FRIENDS_ONLY' }, { idempotencyKey: 'moment-key' });
  await addMomentComment('trace-1', { content: 'hello' }, { idempotencyKey: 'comment-key' });

  assert.equal(calls[0].endpoint, '/trace');
  assert.deepEqual({ ...calls[0].options.headers }, { 'Idempotency-Key': 'moment-key' });
  assert.equal(calls[1].endpoint, '/trace/trace-1/comment');
  assert.deepEqual({ ...calls[1].options.headers }, { 'Idempotency-Key': 'comment-key' });
});

test('setMomentLike PUTs the desired state instead of toggling', async () => {
  const calls = [];
  const { setMomentLike } = loadMomentsApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { liked: false, likeCount: 3 };
  });

  const result = await setMomentLike('trace-1', false);

  assert.equal(calls[0].endpoint, '/trace/trace-1/like');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual({ ...calls[0].options.body }, { liked: false });
  assert.deepEqual({ ...result }, { liked: false, likeCount: 3 });
});
