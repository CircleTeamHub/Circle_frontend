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

const { resolveVoiceSendStrategy } = loadTsModule(
  'src/features/chat/utils/voice-forward.ts',
);

// The module runs in a separate VM realm, so its objects have a different
// Object prototype; JSON round-trip normalizes that (and drops undefined keys).
const plain = (value) => JSON.parse(JSON.stringify(value));

test('prefers remote url over local path and carries the path along', () => {
  assert.deepEqual(
    plain(
      resolveVoiceSendStrategy({
        sourceUrl: 'https://cdn.example.com/v.m4a',
        soundPath: '/tmp/v.m4a',
      }),
    ),
    { kind: 'url', sourceUrl: 'https://cdn.example.com/v.m4a', soundPath: '/tmp/v.m4a' },
  );
});

test('falls back to local path when url is missing or blank', () => {
  assert.deepEqual(
    plain(resolveVoiceSendStrategy({ sourceUrl: '   ', soundPath: '/tmp/v.m4a' })),
    { kind: 'path', soundPath: '/tmp/v.m4a' },
  );
  assert.deepEqual(
    plain(resolveVoiceSendStrategy({ soundPath: '/tmp/v.m4a' })),
    { kind: 'path', soundPath: '/tmp/v.m4a' },
  );
});

test('url strategy omits soundPath when path is blank', () => {
  assert.deepEqual(
    plain(
      resolveVoiceSendStrategy({
        sourceUrl: 'https://cdn.example.com/v.m4a',
        soundPath: '  ',
      }),
    ),
    { kind: 'url', sourceUrl: 'https://cdn.example.com/v.m4a' },
  );
});

test('returns null when neither a playable url nor path exists', () => {
  assert.equal(resolveVoiceSendStrategy({}), null);
  assert.equal(resolveVoiceSendStrategy({ sourceUrl: '', soundPath: '' }), null);
  assert.equal(resolveVoiceSendStrategy({ sourceUrl: null, soundPath: null }), null);
});
