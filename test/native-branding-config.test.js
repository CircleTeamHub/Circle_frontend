const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const readJson = (rel) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'));

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

function loadIntrospectedAndroidApplicationAttributes() {
  const output = execFileSync(
    process.execPath,
    [
      require.resolve('expo/bin/cli'),
      'config',
      '--type',
      'introspect',
      '--json',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const introspected = JSON.parse(output);

  return introspected._internal.modResults.android.manifest.manifest
    .application[0].$;
}

test('expo branding config uses Windnote display names and preserves legacy deep links', () => {
  const app = readJson('app.json').expo;
  const branding = loadTsModule('src/constants/branding.ts');

  assert.equal(app.name, branding.APP_DISPLAY_NAME);
  assert.equal(app.slug, 'windnote-ai');
  assert.deepEqual(app.scheme, Array.from(branding.APP_DEEP_LINK_SCHEMES));
  assert.deepEqual(Array.from(branding.APP_LINK_PROTOCOLS), [
    'windnoteai:',
    'circleim:',
  ]);
  assert.deepEqual(Array.from(branding.APP_UNIVERSAL_LINK_HOSTS), [
    'windnote.ai',
    'www.windnote.ai',
    'circle.im',
    'www.circle.im',
  ]);
  assert.equal(app.ios.bundleIdentifier, 'com.yiboding.circleim');
  assert.equal(app.android.package, 'com.yiboding.circleim');
});

test('android native config disables platform backups for local chat data', () => {
  const app = readJson('app.json').expo;

  assert.equal(app.android.allowBackup, false);
});

test('android prebuild manifest disables platform backups for local chat data', () => {
  const applicationAttributes = loadIntrospectedAndroidApplicationAttributes();

  assert.equal(applicationAttributes['android:allowBackup'], 'false');
});
