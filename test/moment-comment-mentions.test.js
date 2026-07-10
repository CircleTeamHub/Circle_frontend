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

test('addMomentComment includes non-empty mentioned user ids', async () => {
  const calls = [];
  const { addMomentComment } = loadMomentsApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
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
  });

  await addMomentComment('trace-1', {
    content: 'hello',
    mentionedUserIds: [],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), {
    content: 'hello',
  });
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
