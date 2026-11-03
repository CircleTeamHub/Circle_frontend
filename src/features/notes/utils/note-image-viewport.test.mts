import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteImageViewport } from './note-image-viewport.ts';

test('images load near the viewport, unload when scrolled away and unregister cleanly', () => {
  const viewport = createNoteImageViewport();
  viewport.setViewport(100, 400);
  const changes: boolean[] = [];
  const unregister = viewport.register(200, 100, (visible) => changes.push(visible));
  assert.deepEqual(changes, [true]);
  viewport.setScrollOffset(1000);
  assert.deepEqual(changes, [true, false]);
  viewport.setScrollOffset(0);
  assert.deepEqual(changes, [true, false, true]);
  unregister();
  viewport.setScrollOffset(1000);
  assert.deepEqual(changes, [true, false, true]);
});

test('offscreen registration explicitly resets a previously visible image', () => {
  const viewport = createNoteImageViewport();
  viewport.setViewport(100, 400);
  const changes: boolean[] = [];
  const callback = (visible: boolean) => changes.push(visible);
  viewport.register(200, 100, callback)();
  viewport.register(1500, 100, callback);
  assert.deepEqual(changes, [true, false]);
});

test('registration at an existing scroll offset uses content coordinates', () => {
  const viewport = createNoteImageViewport();
  viewport.setViewport(100, 400);
  viewport.setScrollOffset(1000);
  const changes: boolean[] = [];
  viewport.register(200, 100, (visible) => changes.push(visible));
  viewport.setScrollOffset(0);
  assert.deepEqual(changes, [true, false]);
});

test('moving the viewport origin does not relocate registered image content', () => {
  const viewport = createNoteImageViewport();
  viewport.setViewport(100, 400);
  const changes: boolean[] = [];
  viewport.register(850, 100, (visible) => changes.push(visible));
  viewport.setViewport(300, 400);
  assert.deepEqual(changes, [false]);
  viewport.setScrollOffset(100);
  assert.deepEqual(changes, [false, true]);
});

test('registration before viewport measurement waits for the real origin', () => {
  const viewport = createNoteImageViewport();
  const changes: boolean[] = [];
  viewport.register(1200, 100, (visible) => changes.push(visible));
  assert.deepEqual(changes, [false]);
  viewport.setViewport(1000, 400);
  assert.deepEqual(changes, [false, true]);
});
