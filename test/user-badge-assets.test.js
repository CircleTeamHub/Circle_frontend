const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

function loadBadgeAssets() {
  const filePath = path.join(root, 'src/components/ui/user-badge-assets.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request.endsWith('.png')) return request;
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('local badge artwork is mapped by asset filename', () => {
  [
    'assets/badges/vip1.png',
    'assets/badges/vip2.png',
    'assets/badges/vip3.png',
    'assets/badges/vip4.png',
    'assets/badges/vip5.png',
    'assets/badges/newjoiner.png',
    'assets/badges/good1.png',
    'assets/badges/good2.png',
    'assets/badges/good3.png',
    'assets/badges/verifie.png',
    'assets/badges/builder.png',
  ].forEach((assetPath) => assert.ok(exists(assetPath), `${assetPath} should exist`));

  const assets = read('src/components/ui/user-badge-assets.ts');

  assert.match(assets, /vip1\.png/);
  assert.match(assets, /vip2\.png/);
  assert.match(assets, /vip3\.png/);
  assert.match(assets, /vip4\.png/);
  assert.match(assets, /vip5\.png/);
  assert.match(assets, /newjoiner\.png/);
  assert.match(assets, /good1\.png/);
  assert.match(assets, /good2\.png/);
  assert.match(assets, /good3\.png/);
  assert.match(assets, /verifie\.png/);
  assert.match(assets, /builder\.png/);
  assert.match(assets, /getSystemBadgeAsset/);
});

test('UserIconBadge renders system badges from local artwork', () => {
  const row = read('src/components/ui/user-icon-row.tsx');

  assert.match(row, /getSystemBadgeAsset/);
  assert.match(row, /systemBadgeImage/);
  assert.match(row, /contentFit="contain"/);
  assert.match(row, /getSystemBadgeVisualTranslateY/);
  assert.match(row, /translateY/);
});

test('top collaborator badges are mapped from collaboration recognition thresholds', () => {
  const {
    getTopCollaboratorLevel,
    getSystemBadgeAsset,
  } = loadBadgeAssets();

  assert.equal(getTopCollaboratorLevel(99), null);
  assert.equal(getTopCollaboratorLevel(100), 1);
  assert.equal(getTopCollaboratorLevel(999), 1);
  assert.equal(getTopCollaboratorLevel(1000), 2);
  assert.equal(getTopCollaboratorLevel(9999), 2);
  assert.equal(getTopCollaboratorLevel(10000), 3);

  const makeIcon = (recognitionCount) => ({
    id: `top-${recognitionCount}`,
    type: 'SYSTEM',
    systemKey: 'TOP_COLLABORATOR',
    title: 'Top Collaborator',
    imageUrl: null,
    fallbackIconName: null,
    sortOrder: 0,
    recognitionCount,
  });

  assert.equal(getSystemBadgeAsset(makeIcon(99)), null);
  assert.match(getSystemBadgeAsset(makeIcon(100)), /good1\.png$/);
  assert.match(getSystemBadgeAsset(makeIcon(1000)), /good2\.png$/);
  assert.match(getSystemBadgeAsset(makeIcon(10000)), /good3\.png$/);
  assert.equal(getSystemBadgeAsset(makeIcon(undefined)), null);
  assert.equal(
    getSystemBadgeAsset({
      ...makeIcon(undefined),
      title: 'Top Collaborator 10000',
    }),
    null,
  );
});

test('verified profile and circle builder badges use their dedicated local artwork', () => {
  const { getSystemBadgeAsset } = loadBadgeAssets();

  const makeIcon = (systemKey) => ({
    id: `system-${systemKey}`,
    type: 'SYSTEM',
    systemKey,
    title: systemKey,
    imageUrl: null,
    fallbackIconName: null,
    sortOrder: 0,
  });

  assert.match(getSystemBadgeAsset(makeIcon('VERIFIED_PROFILE')), /verifie\.png$/);
  assert.match(getSystemBadgeAsset(makeIcon('CIRCLE_BUILDER')), /builder\.png$/);
});

test('system badge visual scales compensate for uneven transparent artwork padding', () => {
  const { getSystemBadgeVisualScale, getSystemBadgeVisualTranslateY } = loadBadgeAssets();
  const makeIcon = (systemKey, title = systemKey, recognitionCount) => ({
    id: `system-${systemKey}`,
    type: 'SYSTEM',
    systemKey,
    title,
    imageUrl: null,
    fallbackIconName: null,
    sortOrder: 0,
    recognitionCount,
  });

  // 超级(≥VIP4)= super.png 橙色皇冠。该素材内容填满方形画布,需要略微缩小,
  // 否则在“我的徽章”里会比银/金/钻等竖版透明画布素材大一圈。
  assert.equal(getSystemBadgeVisualScale(makeIcon('VIP', 'VIP5')), 0.8);
  assert.equal(getSystemBadgeVisualScale(makeIcon('VIP', 'VIP4')), 0.8);
  assert.equal(getSystemBadgeVisualScale(makeIcon('VIP', 'VIP3')), 1.16);
  assert.equal(getSystemBadgeVisualScale(makeIcon('VIP', 'VIP1')), 1.16);
  assert.equal(getSystemBadgeVisualScale(makeIcon('NEW_USER')), 1.16);
  assert.equal(getSystemBadgeVisualScale(makeIcon('CIRCLE_BUILDER')), 1.16);
  assert.equal(getSystemBadgeVisualScale(makeIcon('VERIFIED_PROFILE')), 1);
  assert.equal(getSystemBadgeVisualScale(makeIcon('TOP_COLLABORATOR', 'Top', 1000)), 1.04);

  assert.equal(getSystemBadgeVisualTranslateY(makeIcon('VIP', 'VIP5')), -8);
  assert.equal(getSystemBadgeVisualTranslateY(makeIcon('VIP', 'VIP3')), 2);
  assert.equal(getSystemBadgeVisualTranslateY(makeIcon('CIRCLE_BUILDER')), 1);
  assert.equal(getSystemBadgeVisualTranslateY(makeIcon('VERIFIED_PROFILE')), 3);
  assert.equal(getSystemBadgeVisualTranslateY(makeIcon('TOP_COLLABORATOR', 'Top', 1000)), 0);
});

test('first release system badge keys are modeled on the client', () => {
  const types = read('src/types/index.ts');

  [
    'VIP',
    'NEW_USER',
    'TOP_COLLABORATOR',
    'VERIFIED_PROFILE',
    'CIRCLE_BUILDER',
  ].forEach((key) => assert.match(types, new RegExp(`'${key}'`)));
});

test('partner is not kept as a separate system badge key', () => {
  const types = read('src/types/index.ts');
  const assets = read('src/components/ui/user-badge-assets.ts');
  const row = read('src/components/ui/user-icon-row.tsx');

  assert.doesNotMatch(types, /'PARTNER'/);
  assert.doesNotMatch(assets, /PARTNER/);
  assert.doesNotMatch(row, /PARTNER/);
});

test('badge artwork stays within the mobile asset budget', () => {
  const { PNG } = require('pngjs');
  const maxBytes = 160 * 1024;
  const maxWidth = 320;
  const maxHeight = 420;
  const badgeDir = path.join(root, 'assets/badges');

  for (const name of fs.readdirSync(badgeDir)) {
    if (!name.endsWith('.png')) continue;
    const absolutePath = path.join(badgeDir, name);
    const data = fs.readFileSync(absolutePath);
    const png = PNG.sync.read(data);

    assert.ok(data.length <= maxBytes, `${name} is ${data.length} bytes`);
    assert.ok(png.width <= maxWidth, `${name} width is ${png.width}`);
    assert.ok(png.height <= maxHeight, `${name} height is ${png.height}`);
  }
});
