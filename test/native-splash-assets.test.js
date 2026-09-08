const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel));
const readText = (rel) => read(rel).toString('utf8');
const readJson = (rel) => JSON.parse(readText(rel));

function getLogoCoverage(rel) {
  const image = PNG.sync.read(read(rel));
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let weightedX = 0;
  let totalWeight = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const a = image.data[i + 3];
      const isWhite = r > 245 && g > 245 && b > 245;

      if (a > 10 && !isWhite) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        const darkness = 255 - (r + g + b) / 3;
        const weight = Math.max(1, darkness) * (a / 255);
        weightedX += (x + 0.5) * weight;
        totalWeight += weight;
      }
    }
  }

  return {
    width: image.width,
    height: image.height,
    coverageX: (maxX - minX + 1) / image.width,
    coverageY: (maxY - minY + 1) / image.height,
    centerX: (minX + maxX + 1) / 2 / image.width,
    centerY: (minY + maxY + 1) / 2 / image.height,
    centroidX: weightedX / totalWeight / image.width,
  };
}

function getNonWhiteRowBands(rel) {
  const image = PNG.sync.read(read(rel));
  const occupiedRows = [];

  for (let y = 0; y < image.height; y += 1) {
    let occupied = false;
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const isWhite =
        image.data[i] > 245 && image.data[i + 1] > 245 && image.data[i + 2] > 245;
      if (image.data[i + 3] > 10 && !isWhite) {
        occupied = true;
        break;
      }
    }
    if (occupied) occupiedRows.push(y);
  }

  const bands = [];
  for (const row of occupiedRows) {
    const current = bands.at(-1);
    if (!current || row > current.end + 1) {
      bands.push({ start: row, end: row });
    } else {
      current.end = row;
    }
  }

  return bands.map(({ start, end }) => ({
    start: start / image.height,
    end: (end + 1) / image.height,
  }));
}

/**
 * 按饱和度挑出「品牌标本体」的包围盒。
 *
 * getLogoCoverage 量的是「非白像素」，只适用于 Logo 画在纯白底上的图。桌面图标
 * 现在自带磨砂底，整幅都是非白，那个量法恒为 1、什么也守不住。
 *
 * 紫色飞机与背景在饱和度上有一整段空档：磨砂卡与淡紫底的 max-min 都 < 96，
 * 飞机描边/填充都 >= 128。阈值取 128 落在空档中间，不卡边界。
 */
function getMarkCoverage(rel, minSaturation = 128) {
  const image = PNG.sync.read(read(rel));
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < minSaturation) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    width: image.width,
    height: image.height,
    coverageX: (maxX - minX + 1) / image.width,
    coverageY: (maxY - minY + 1) / image.height,
    centerX: (minX + maxX + 1) / 2 / image.width,
    centerY: (minY + maxY + 1) / 2 / image.height,
  };
}

function assertSolidWhitePng(rel) {
  const image = PNG.sync.read(read(rel));
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      assert.ok(
        image.data[i] > 245 &&
          image.data[i + 1] > 245 &&
          image.data[i + 2] > 245 &&
          image.data[i + 3] > 245,
        `${rel} should be a solid white adaptive-icon background`,
      );
    }
  }
}

test('expo splash config uses a white background and the standalone chat icon', () => {
  const app = readJson('app.json').expo;

  assert.equal(app.splash.backgroundColor, '#FFFFFF');
  assert.equal(app.splash.image, './assets/images/splash-tagline.png');
  assert.equal(app.android.adaptiveIcon.backgroundColor, '#FFFFFF');
  assert.equal(
    app.android.adaptiveIcon.foregroundImage,
    './assets/images/android-icon-foreground.png',
  );
  assert.equal(
    app.android.adaptiveIcon.backgroundImage,
    './assets/images/android-icon-background.png',
  );
  assert.equal(
    app.android.adaptiveIcon.monochromeImage,
    './assets/images/android-icon-monochrome.png',
  );

  const assets = [
    {
      rel: 'assets/images/splash-tagline.png',
      minCoverage: 0.25,
      maxCoverage: 0.6,
      maxCenterOffsetY: 0.06,
    },
    {
      rel: 'assets/images/android-icon-foreground.png',
      minCoverage: 0.42,
      maxCoverage: 0.52,
      maxCentroidOffsetX: 0.035,
    },
    {
      rel: 'assets/images/android-icon-monochrome.png',
      minCoverage: 0.42,
      maxCoverage: 0.52,
      maxCentroidOffsetX: 0.035,
    },
  ];

  for (const {
    rel,
    minCoverage,
    maxCoverage,
    maxCentroidOffsetX,
    maxCenterOffsetY = 0.05,
  } of assets) {
    const coverage = getLogoCoverage(rel);
    assert.ok(
      coverage.coverageX > minCoverage && coverage.coverageX < maxCoverage,
      `${rel} should contain a centered logo, got horizontal coverage ${coverage.coverageX}`,
    );
    assert.ok(
      coverage.coverageY > minCoverage && coverage.coverageY < maxCoverage,
      `${rel} should contain a centered logo, got vertical coverage ${coverage.coverageY}`,
    );
    assert.ok(
      Math.abs(coverage.centerX - 0.5) < 0.05,
      `${rel} should be horizontally centered, got center ${coverage.centerX}`,
    );
    assert.ok(
      Math.abs(coverage.centerY - 0.5) < maxCenterOffsetY,
      `${rel} should be vertically centered, got center ${coverage.centerY}`,
    );
    if (typeof maxCentroidOffsetX === 'number') {
      assert.ok(
        Math.abs(coverage.centroidX - 0.5) < maxCentroidOffsetX,
        `${rel} should be visually centered, got weighted center ${coverage.centroidX}`,
      );
    }
  }

  const splashBands = getNonWhiteRowBands('assets/images/splash-tagline.png');
  assert.equal(splashBands.length, 1, 'splash image should contain only the chat icon');
  assert.ok(splashBands[0].start > 0.2, 'chat icon should be vertically centered');
  assert.ok(splashBands[0].end < 0.8, 'chat icon should be vertically centered');

  assertSolidWhitePng('assets/images/android-icon-background.png');
});

test('iOS home-screen icon is a full-bleed frosted mark with no alpha', () => {
  const rel = 'assets/images/icon.png';
  const image = PNG.sync.read(read(rel));

  assert.equal(image.width, 1024);
  assert.equal(image.height, 1024);

  // iOS 不收带 alpha 通道的 App 图标。这条最容易在「换了张设计稿」时失守 ——
  // 设计工具导出 PNG 默认带透明通道,而症状要到打包上传或装机后才看得见。
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] !== 255) {
      assert.fail(`${rel} must be fully opaque; iOS rejects app icons with alpha`);
    }
  }

  // 满幅设计:图标自带磨砂底,四角必须已经上色。留白的角意味着这张图退回了
  // 「Logo 居中 + 白底」的老形态,iOS 的圆角遮罩切下去会在边缘露出白边。
  const corner = (x, y) => {
    const i = (y * image.width + x) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  };
  for (const [x, y] of [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ]) {
    const [r, g, b] = corner(x, y);
    assert.ok(
      !(r > 245 && g > 245 && b > 245),
      `${rel} corner (${x},${y}) is white — the icon should paint its own background edge to edge`,
    );
  }

  // 飞机本体居中、占一半左右画布。换稿时挡住两件事:mark 漂到一边,或者被缩到
  // 磨砂卡里变成一个小图钉(桌面上 60pt 见方,缩过头就认不出是什么了)。
  const mark = getMarkCoverage(rel);
  assert.ok(
    mark.coverageX > 0.45 && mark.coverageX < 0.62,
    `${rel} mark should span about half the canvas, got horizontal ${mark.coverageX}`,
  );
  assert.ok(
    mark.coverageY > 0.45 && mark.coverageY < 0.62,
    `${rel} mark should span about half the canvas, got vertical ${mark.coverageY}`,
  );
  assert.ok(Math.abs(mark.centerX - 0.5) < 0.05, `mark centerX ${mark.centerX}`);
  assert.ok(Math.abs(mark.centerY - 0.5) < 0.05, `mark centerY ${mark.centerY}`);
});
