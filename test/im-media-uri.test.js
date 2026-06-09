const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(relativePath) {
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

const { toPlayableUri, stripFileScheme } = loadModule('src/im/media-uri.ts');

test('toPlayableUri adds file:// to a bare local recording path', () => {
  assert.equal(
    toPlayableUri('/var/mobile/Containers/Data/Application/rec.m4a'),
    'file:///var/mobile/Containers/Data/Application/rec.m4a',
  );
});

test('toPlayableUri leaves remote http(s) urls untouched', () => {
  assert.equal(
    toPlayableUri('https://im.example.com/object/voice.m4a'),
    'https://im.example.com/object/voice.m4a',
  );
  assert.equal(
    toPlayableUri('http://192.168.1.10:10002/voice.m4a'),
    'http://192.168.1.10:10002/voice.m4a',
  );
});

test('toPlayableUri leaves an already-schemed uri untouched (file://, content://)', () => {
  assert.equal(toPlayableUri('file:///var/rec.m4a'), 'file:///var/rec.m4a');
  assert.equal(toPlayableUri('content://media/external/audio/1'), 'content://media/external/audio/1');
});

test('toPlayableUri returns empty/nullish input unchanged', () => {
  assert.equal(toPlayableUri(''), '');
});

test('stripFileScheme drops a leading file:// so the OpenIM SDK gets a bare path', () => {
  assert.equal(stripFileScheme('file:///var/mobile/rec.m4a'), '/var/mobile/rec.m4a');
  assert.equal(stripFileScheme('/var/mobile/rec.m4a'), '/var/mobile/rec.m4a');
});

test('stripFileScheme and toPlayableUri are inverse for a local path (send → store → play)', () => {
  const recorded = 'file:///var/mobile/rec.m4a';
  const stored = stripFileScheme(recorded); // what OpenIM persists in soundElem.soundPath
  assert.equal(stored, '/var/mobile/rec.m4a');
  assert.equal(toPlayableUri(stored), recorded); // what the audio player needs back
});
