const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
    require: (specifier) => {
      if (specifier === '@/services/api/client') return { apiClient };
      if (specifier === '@/services/api/utils') {
        return { buildQuery: () => '', normalizeMediaUrl: (value) => value };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
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
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), {
    content: '@Alice hello',
    mentionedUserIds: ['alice-id'],
  });
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
  });

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
  });

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
  assert.match(feed, /mentionedUserIds,\s*\}\);/);
  assert.match(detail, /mentionedUserIds,\s*\}\);/);
});
