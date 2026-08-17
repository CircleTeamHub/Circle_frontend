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

test('expo splash config uses a white background and the app icon with its tagline', () => {
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
      // iOS home-screen icon is full-bleed: iOS applies its own rounded mask and
      // does NOT crop a safe zone the way Android adaptive icons do, so the logo
      // must fill most of the canvas (a safe-zone-padded image renders as a tiny
      // logo lost in whitespace). Kept distinct from the Android foreground below.
      // Centroid check omitted — the paper plane's visual mass is inherently
      // off-center, which is fine for a bbox-centered full-bleed icon.
      rel: 'assets/images/icon.png',
      minCoverage: 0.7,
      maxCoverage: 0.84,
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
  assert.equal(splashBands.length, 2, 'splash image should contain separate icon and tagline rows');
  assert.ok(splashBands[1].start > 0.7, 'tagline should sit below the app icon');

  assertSolidWhitePng('assets/images/android-icon-background.png');
});
