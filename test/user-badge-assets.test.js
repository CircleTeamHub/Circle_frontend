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
  assert.match(row, /getSystemBadgeArtBox/);
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

// 系统徽章的 PNG 四周留着多少不等的透明边(实心画面只占画布 58%~86%),画面也不一定在正中。
// 记下每张素材可见部分的大小和中心偏移(都按画布长边算),渲染时据此居中、放大,
// 让各徽章和圆形圈子徽章一样大、圆心对齐。这里直接量 PNG 核对记下的数。
test('system badge art boxes match the real artwork', () => {
  const { getSystemBadgeAsset, getSystemBadgeArtBox } = loadBadgeAssets();
  const { PNG } = require('pngjs');
  const measure = (rel) => {
    const png = PNG.sync.read(fs.readFileSync(path.join(root, rel)));
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        // 只量实心部分:素材底下那圈很淡的投影在深色背景上看不见,算进来会高估画面、把中心往下拉。
        if (png.data[(y * png.width + x) * 4 + 3] > 128) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    }
    const long = Math.max(png.width, png.height);
    return {
      visibleRatio: Math.max(x1 - x0 + 1, y1 - y0 + 1) / long,
      offsetX: ((x0 + x1 + 1) / 2 - png.width / 2) / long,
      offsetY: ((y0 + y1 + 1) / 2 - png.height / 2) / long,
    };
  };
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
  const icons = [
    makeIcon('VIP', 'VIP1'),
    makeIcon('VIP', 'VIP2'),
    makeIcon('VIP', 'VIP3'),
    makeIcon('VIP', 'VIP5'),
    makeIcon('NEW_USER'),
    makeIcon('CIRCLE_BUILDER'),
    makeIcon('VERIFIED_PROFILE'),
    makeIcon('TOP_COLLABORATOR', 'Top', 100),
    makeIcon('TOP_COLLABORATOR', 'Top', 1000),
    makeIcon('TOP_COLLABORATOR', 'Top', 10000),
  ];
  for (const icon of icons) {
    const rel = getSystemBadgeAsset(icon).replace(/^(\.\.\/)+/, '');
    const recorded = getSystemBadgeArtBox(icon);
    const measured = measure(rel);
    assert.ok(Math.abs(recorded.visibleRatio - measured.visibleRatio) < 0.01, `${rel}: visibleRatio ${recorded.visibleRatio} vs ${measured.visibleRatio.toFixed(3)}`);
    assert.ok(Math.abs(recorded.offsetX - measured.offsetX) < 0.005, `${rel}: offsetX ${recorded.offsetX} vs ${measured.offsetX.toFixed(3)}`);
    assert.ok(Math.abs(recorded.offsetY - measured.offsetY) < 0.005, `${rel}: offsetY ${recorded.offsetY} vs ${measured.offsetY.toFixed(3)}`);
  }
  assert.deepEqual({ ...getSystemBadgeArtBox(makeIcon('UNKNOWN')) }, { visibleRatio: 1, offsetX: 0, offsetY: 0 });
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
