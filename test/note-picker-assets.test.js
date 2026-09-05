const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPickerAssets({ window, URL } = {}) {
  const filePath = path.join(process.cwd(), 'src/features/notes/utils/note-picker-assets.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    window,
    URL,
    require: (request) => {
      if (request === './note-media-upload') return { MAX_NOTE_MEDIA_SELECTION: 10 };
      throw new Error(`unexpected dependency: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('caps picker assets in original order and exposes overflow for user feedback', () => {
  const { splitPickerAssets } = loadPickerAssets();
  const assets = Array.from({ length: 12 }, (_, index) => ({ uri: `blob:asset-${index}` }));
  const { selectedAssets, overflowAssets } = splitPickerAssets(assets);

  assert.deepEqual([...selectedAssets.map((asset) => asset.uri)], assets.slice(0, 10).map((asset) => asset.uri));
  assert.deepEqual([...overflowAssets.map((asset) => asset.uri)], assets.slice(10).map((asset) => asset.uri));
});

test('releases owned web blob previews only after they are no longer needed', () => {
  const revoked = [];
  const { revokeOwnedPickerPreview } = loadPickerAssets({
    window: {},
    URL: { revokeObjectURL: (uri) => revoked.push(uri) },
  });

  revokeOwnedPickerPreview('https://cdn.example/kept.jpg');
  revokeOwnedPickerPreview('blob:removed-preview');

  assert.deepEqual(revoked, ['blob:removed-preview']);
});

test('owns picker blob URLs until each preview is disposed exactly once', () => {
  const revoked = [];
  const { createPickerPreviewDisposer } = loadPickerAssets({
    window: {},
    URL: { revokeObjectURL: (uri) => revoked.push(uri) },
  });
  const disposer = createPickerPreviewDisposer();

  disposer.retain('blob:active-preview');
  disposer.retain('https://cdn.example/not-owned.jpg');
  disposer.dispose('blob:active-preview');
  disposer.dispose('blob:active-preview');
  disposer.disposeAll();

  assert.deepEqual(revoked, ['blob:active-preview']);
});
