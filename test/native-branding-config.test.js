const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {
  parseXMLAsync,
} = require('@expo/config-plugins/build/utils/XML');

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

function runExpoConfig(args) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('expo/bin/cli'),
      'config',
      ...args,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(
    result.status,
    0,
    `Expo config failed:\n${result.stderr || result.stdout}`,
  );

  return result;
}

function loadIntrospectedAndroidApplicationAttributes() {
  const result = runExpoConfig(['--type', 'introspect', '--json']);
  const introspected = JSON.parse(result.stdout);

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
  assert.equal(
    applicationAttributes['android:fullBackupContent'],
    '@xml/windnote_backup_rules',
  );
  assert.equal(
    applicationAttributes['android:dataExtractionRules'],
    '@xml/windnote_data_extraction_rules',
  );
});

test('Expo introspection has no SecureStore backup-rule conflict', () => {
  const result = runExpoConfig(['--type', 'introspect']);

  assert.doesNotMatch(
    result.stderr,
    /Expo-secure-store tried to apply Android Auto Backup rules/,
  );
});

test('dangerous mod writes owned Android backup rules', async () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'windnote-backup-rules-'),
  );
  const plugin = require('../plugins/with-android-allow-backup-disabled');
  const expectedExcludes = [
    { domain: 'file', path: 'openim' },
    { domain: 'file', path: 'mmkv' },
    { domain: 'sharedpref', path: 'SecureStore' },
  ];

  try {
    const config = plugin({ name: 'windnote-test', slug: 'windnote-test' });
    const dangerousMod = config.mods?.android?.dangerous;

    assert.equal(typeof dangerousMod, 'function');
    await dangerousMod({
      ...config,
      modResults: {},
      modRequest: {
        projectRoot,
        platform: 'android',
        modName: 'dangerous',
        projectName: 'windnote-test',
      },
    });

    const xmlDir = path.join(
      projectRoot,
      'android',
      'app',
      'src',
      'main',
      'res',
      'xml',
    );
    const [legacyXml, modernXml] = await Promise.all([
      fs.promises.readFile(
        path.join(xmlDir, 'windnote_backup_rules.xml'),
        'utf8',
      ),
      fs.promises.readFile(
        path.join(xmlDir, 'windnote_data_extraction_rules.xml'),
        'utf8',
      ),
    ]);
    const [legacyRules, modernRules] = await Promise.all([
      parseXMLAsync(legacyXml),
      parseXMLAsync(modernXml),
    ]);
    const attributes = (rules) => rules.map((rule) => rule.$);

    assert.deepEqual(
      attributes(legacyRules['full-backup-content'].exclude),
      expectedExcludes,
    );
    assert.deepEqual(
      attributes(
        modernRules['data-extraction-rules']['cloud-backup'][0].exclude,
      ),
      expectedExcludes,
    );
    assert.deepEqual(
      attributes(
        modernRules['data-extraction-rules']['device-transfer'][0].exclude,
      ),
      expectedExcludes,
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
