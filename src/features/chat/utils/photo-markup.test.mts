import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMarkupPoint,
  normalizeMarkupPoint,
  renderMarkupStroke,
  type PhotoMarkupStroke,
} from './photo-markup.ts';

const stroke: PhotoMarkupStroke = {
  id: 'stroke-1',
  tool: 'draw',
  color: '#FF3B30',
  widthRatio: 0.02,
  points: [{ x: 0.25, y: 0.5 }],
};

test('touch points are normalized and clamped to the visible photo', () => {
  assert.deepEqual(normalizeMarkupPoint(100, 50, 400, 200), {
    x: 0.25,
    y: 0.25,
  });
  assert.deepEqual(normalizeMarkupPoint(-20, 240, 400, 200), {
    x: 0,
    y: 1,
  });
  assert.equal(normalizeMarkupPoint(10, 10, 0, 200), null);
});

test('dense move events are ignored while meaningful brush movement is retained', () => {
  assert.equal(appendMarkupPoint(stroke, { x: 0.251, y: 0.501 }), stroke);
  const extended = appendMarkupPoint(stroke, { x: 0.4, y: 0.7 });
  assert.notEqual(extended, stroke);
  assert.deepEqual(extended.points, [
    { x: 0.25, y: 0.5 },
    { x: 0.4, y: 0.7 },
  ]);
});

test('normalized strokes scale to preview and full photo with matching proportions', () => {
  assert.deepEqual(renderMarkupStroke(stroke, 400, 200), {
    id: 'stroke-1',
    tool: 'draw',
    color: '#FF3B30',
    strokeWidth: 4,
    points: [{ x: 100, y: 100 }],
  });
  assert.deepEqual(renderMarkupStroke(stroke, 1200, 600), {
    id: 'stroke-1',
    tool: 'draw',
    color: '#FF3B30',
    strokeWidth: 12,
    points: [{ x: 300, y: 300 }],
  });
});

test('invalid export dimensions do not produce a rendered stroke', () => {
  assert.equal(renderMarkupStroke(stroke, 0, 100), null);
  assert.equal(
    renderMarkupStroke({ ...stroke, points: [] }, 100, 100),
    null,
  );
});
