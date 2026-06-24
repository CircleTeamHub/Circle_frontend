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

test('expo splash config uses a white background and centered app icon assets', () => {
  const app = readJson('app.json').expo;

  assert.equal(app.splash.backgroundColor, '#FFFFFF');
  assert.equal(app.splash.image, './assets/images/splash-icon.png');
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
      rel: 'assets/images/splash-icon.png',
      minCoverage: 0.25,
      maxCoverage: 0.6,
    },
    {
      rel: 'assets/images/icon.png',
      minCoverage: 0.5,
      maxCoverage: 0.85,
    },
    {
      rel: 'assets/images/android-icon-foreground.png',
      minCoverage: 0.5,
      maxCoverage: 0.85,
    },
    {
      rel: 'assets/images/android-icon-monochrome.png',
      minCoverage: 0.5,
      maxCoverage: 0.85,
    },
  ];

  for (const { rel, minCoverage, maxCoverage } of assets) {
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
      Math.abs(coverage.centerY - 0.5) < 0.05,
      `${rel} should be vertically centered, got center ${coverage.centerY}`,
    );
  }

  assertSolidWhitePng('assets/images/android-icon-background.png');
});
