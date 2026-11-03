const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const sourcePath = 'src/features/messages/utils/scan-album-qr.ts';
const card = { uri: 'file:///personal-card.png', width: 960, height: 1440 };
const found = { type: 'qr', data: 'windnoteai://qr?token=album-card-token' };

function setup({ os = 'android', sourceSize = card, scan = async () => [], renderError, saveError } = {}) {
  const scans = [];
  const contexts = [];
  const images = [];
  const deleted = [];
  const saved = [];
  const { scanQrFromAlbum } = loadTsModule(sourcePath, {
    requireShim(name) {
      if (name === 'react-native') return { Platform: { OS: os } };
      if (name === 'expo-camera') return {
        scanFromURLAsync: async (uri, types) => {
          scans.push({ uri, types: [...types] });
          return scan(uri, scans.length);
        },
      };
      if (name === 'expo-file-system/legacy') return {
        deleteAsync: async (uri, options) => {
          assert.equal(options.idempotent, true);
          deleted.push(uri);
        },
      };
      if (name === 'expo-image-manipulator') return {
        SaveFormat: { PNG: 'png' },
        ImageManipulator: {
          manipulate(source) {
            const context = { source, actions: [], released: false };
            contexts.push(context);
            const native = {
              resize(size) { context.actions.push({ resize: { ...size } }); return native; },
              crop(rect) { context.actions.push({ crop: { ...rect } }); return native; },
              release() { context.released = true; },
              async renderAsync() {
                if (renderError) throw renderError;
                let width = typeof source === 'string' ? sourceSize.width : source.width;
                let height = typeof source === 'string' ? sourceSize.height : source.height;
                for (const action of context.actions) {
                  if (action.crop) ({ width, height } = action.crop);
                  if (action.resize) {
                    const scale = action.resize.width ? action.resize.width / width : action.resize.height / height;
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                  }
                }
                const image = {
                  width, height, released: false,
                  release() { image.released = true; },
                  async saveAsync(options) {
                    if (saveError) throw saveError;
                    const uri = `file:///scan-scratch-${saved.length}.png`;
                    saved.push({ uri, options });
                    return { uri, width, height };
                  },
                };
                images.push(image);
                return image;
              },
            };
            return native;
          },
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { scanQrFromAlbum, scans, contexts, images, saved, deleted };
}

function assertReleased(state) {
  assert.ok(state.contexts.every((value) => value.released), 'native contexts released');
  assert.ok(state.images.every((value) => value.released), 'native bitmaps released');
  assert.deepEqual(state.deleted, state.saved.map(({ uri }) => uri), 'scratch PNGs deleted before return');
  assert.ok(!state.deleted.includes(card.uri), 'selected card remains intact');
}

test('Android retries an embedded card QR using a bounded crop without changing the selected card', async () => {
  const state = setup({ scan: async (_uri, attempt) => attempt === 3 ? [found] : [] });
  assert.equal(await state.scanQrFromAlbum(card), found);
  assert.equal(state.scans[0].uri, card.uri);
  assert.equal(state.contexts[1].source, state.images[0]);
  const [crop, resize] = state.contexts[1].actions;
  assert.deepEqual(crop, { crop: { originX: 48, originY: 288, width: 864, height: 864 } });
  assert.deepEqual(resize, { resize: { width: 1024 } });
  assert.ok(state.scans.every(({ types }) => types.length === 1 && types[0] === 'qr'));
  assert.ok(state.saved.every(({ options }) => options.format === 'png'));
  assertReleased(state);
});

test('a recognized original image does not create native bitmaps or scratch files', async () => {
  const state = setup({ scan: async () => [found] });
  assert.equal(await state.scanQrFromAlbum(card), found);
  assert.equal(state.scans.length, 1);
  assert.equal(state.contexts.length, 0);
});

test('iOS retains its original scanner behavior when no QR is found', async () => {
  const state = setup({ os: 'ios' });
  assert.equal(await state.scanQrFromAlbum(card), undefined);
  assert.equal(state.scans.length, 1);
  assert.equal(state.contexts.length, 0);
});

test('Android scans a normalized full image before trying any crops', async () => {
  const state = setup({ scan: async (_uri, attempt) => attempt === 2 ? [found] : [] });
  assert.equal(await state.scanQrFromAlbum({ ...card, width: 6000, height: 9000 }), found);
  assert.deepEqual(state.contexts[0].actions, [{ resize: { height: 1600 } }]);
  assert.equal(state.contexts.length, 1);
  assertReleased(state);
});

test('no-code images have at most three overlapping in-bounds crops and release every attempt', async () => {
  const state = setup();
  assert.equal(await state.scanQrFromAlbum(card), undefined);
  assert.equal(state.scans.length, 5);
  const crops = state.contexts.slice(1).map(({ actions }) => actions[0].crop);
  assert.equal(crops.length, 3);
  assert.equal(new Set(crops.map(({ originY }) => originY)).size, 3);
  for (const crop of crops) {
    assert.ok(crop.originX >= 0 && crop.originY >= 0);
    assert.ok(crop.originX + crop.width <= card.width);
    assert.ok(crop.originY + crop.height <= card.height);
  }
  assertReleased(state);
});

test('the lower overlapping crop preserves every dark module of a real QR below the card identity row', async () => {
  // Use the same encoder as react-native-qrcode-svg: a 33-module QR rendered at 20px/module.
  const qr = require('qrcode').create(found.data, { version: 4, errorCorrectionLevel: 'M' }).modules;
  const state = setup({ scan: async (_uri, attempt) => {
    if (attempt < 3) return [];
    const { crop } = state.contexts.at(-1).actions[0];
    const allModulesVisible = qr.data.every((dark, index) => {
      if (!dark) return true;
      const x = 150 + (index % qr.size) * 20;
      const y = 520 + Math.floor(index / qr.size) * 20;
      return x >= crop.originX && y >= crop.originY &&
        x + 20 <= crop.originX + crop.width && y + 20 <= crop.originY + crop.height;
    });
    return allModulesVisible ? [found] : [];
  } });
  assert.equal(await state.scanQrFromAlbum(card), found);
  assert.equal(state.scans.length, 4, 'center crop clips this lower QR; the next crop contains it');
  assertReleased(state);
});

test('a native scanner failure still deletes scratch images and releases bitmaps', async () => {
  const failure = new Error('native scan failed');
  const state = setup({ scan: async (_uri, attempt) => {
    if (attempt > 1) throw failure;
    return [];
  } });
  await assert.rejects(state.scanQrFromAlbum(card), failure);
  assertReleased(state);
});

test('square QR images receive only one crop, while landscape crops stay within the decoded image', async () => {
  for (const sourceSize of [{ width: 220, height: 220 }, { width: 1440, height: 960 }]) {
    const state = setup({ sourceSize });
    assert.equal(await state.scanQrFromAlbum({ ...card, ...sourceSize }), undefined);
    const crops = state.contexts.slice(1).map(({ actions }) => actions[0].crop);
    assert.equal(crops.length, sourceSize.width === sourceSize.height ? 1 : 3);
    for (const crop of crops) {
      assert.ok(crop.originX >= 0 && crop.originY >= 0);
      assert.ok(crop.originX + crop.width <= sourceSize.width);
      assert.ok(crop.originY + crop.height <= sourceSize.height);
    }
    assertReleased(state);
  }
});

test('a crop scan failure releases both the normalized image and the cropped image', async () => {
  const failure = new Error('crop scan failed');
  const state = setup({ scan: async (_uri, attempt) => {
    if (attempt === 3) throw failure;
    return [];
  } });
  await assert.rejects(state.scanQrFromAlbum(card), failure);
  assert.equal(state.images.length, 2);
  assertReleased(state);
});

test('rendering and saving failures release the native context and any rendered bitmap', async () => {
  for (const stage of ['renderError', 'saveError']) {
    const failure = new Error(stage);
    const state = setup({ [stage]: failure });
    await assert.rejects(state.scanQrFromAlbum(card), failure);
    assertReleased(state);
  }
});
