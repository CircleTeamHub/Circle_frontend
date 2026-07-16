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

function loadIntrospectedConfig() {
  const result = runExpoConfig(['--type', 'introspect', '--json']);

  return JSON.parse(result.stdout);
}

function loadIntrospectedAndroidApplicationAttributes() {
  return loadIntrospectedConfig()._internal.modResults.android.manifest.manifest
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

// 两端的平台默认值本来就是安全的（iOS ATS 默认不允许任意加载；Android
// targetSdk>=28 起 usesCleartextTraffic 默认 false）。这里显式写死不是在修漏洞，
// 而是纵深防御：挡住将来某个依赖的 config plugin 往 manifest / infoPlist 里悄悄
// 合并一个宽松值——那种回归没有测试根本看不出来。JS 侧的 assertSecureTransport
// （constants/transport-security.ts）只管我们自己拼的 URL，管不到原生栈。
test('app config pins transport security to encrypted-only on both platforms', () => {
  const app = readJson('app.json').expo;
  const buildProperties = app.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );

  assert.ok(
    buildProperties,
    'expo-build-properties must stay configured — it is what pins usesCleartextTraffic',
  );
  assert.equal(buildProperties[1].android.usesCleartextTraffic, false);
  assert.equal(
    app.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,
    false,
  );
});

test('prebuild config forbids cleartext traffic on both platforms', () => {
  const introspected = loadIntrospectedConfig();
  const applicationAttributes =
    introspected._internal.modResults.android.manifest.manifest.application[0].$;
  const infoPlist = introspected._internal.modResults.ios.infoPlist;

  // 走到 manifest 属性 / infoPlist 这一层，才证明 plugin 真的被应用了；
  // 只断言 app.json 的话，plugin 掉了也照样绿。
  assert.equal(applicationAttributes['android:usesCleartextTraffic'], 'false');
  assert.equal(infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
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
