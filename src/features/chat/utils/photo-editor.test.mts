import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContainedPhotoBounds,
  mapDisplayCropToPhotoPixels,
  moveDisplayCrop,
  resizeDisplayCrop,
} from './photo-editor.ts';

test('contained photo bounds match the visible image inside a preview', () => {
  assert.deepEqual(getContainedPhotoBounds(400, 600, 1200, 600), {
    x: 0,
    y: 200,
    width: 400,
    height: 200,
  });
  assert.deepEqual(getContainedPhotoBounds(400, 600, 400, 800), {
    x: 50,
    y: 0,
    width: 300,
    height: 600,
  });
});

test('display crop maps back to original photo pixels', () => {
  assert.deepEqual(
    mapDisplayCropToPhotoPixels(
      { x: 100, y: 250, width: 200, height: 100 },
      { x: 0, y: 200, width: 400, height: 200 },
      1200,
      600,
    ),
    { originX: 300, originY: 150, width: 600, height: 300 },
  );
});

test('display crop mapping clamps the frame to the visible image', () => {
  assert.deepEqual(
    mapDisplayCropToPhotoPixels(
      { x: -20, y: 180, width: 500, height: 260 },
      { x: 0, y: 200, width: 400, height: 200 },
      1200,
      600,
    ),
    { originX: 0, originY: 0, width: 1200, height: 600 },
  );
});

test('moving a crop frame cannot move it outside the photo', () => {
  const bounds = { x: 10, y: 20, width: 300, height: 200 };
  const crop = { x: 60, y: 50, width: 100, height: 80 };
  assert.deepEqual(moveDisplayCrop(crop, -500, 500, bounds), {
    x: 10,
    y: 140,
    width: 100,
    height: 80,
  });
});

test('corner resizing is free-form, bounded, and keeps a minimum size', () => {
  const bounds = { x: 0, y: 0, width: 300, height: 200 };
  const crop = { x: 40, y: 30, width: 180, height: 120 };
  assert.deepEqual(resizeDisplayCrop(crop, 'topLeft', 50, 20, bounds, 72), {
    x: 90,
    y: 50,
    width: 130,
    height: 100,
  });
  assert.deepEqual(
    resizeDisplayCrop(crop, 'bottomRight', -500, -500, bounds, 72),
    { x: 40, y: 30, width: 72, height: 72 },
  );
});

test('invalid preview or photo dimensions do not produce crop geometry', () => {
  assert.equal(getContainedPhotoBounds(0, 600, 1200, 600), null);
  assert.equal(
    mapDisplayCropToPhotoPixels(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      100,
      100,
    ),
    null,
  );
});
