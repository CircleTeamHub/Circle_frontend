import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_MEDIA_TYPE_LIMITS,
  fitPickedAssetsToNoteMediaLimit,
  noteMediaLimitTypeFor,
  remainingNoteMediaSlots,
} from './note-media-policy.ts';

const item = (type: 'IMAGE' | 'VIDEO') => ({ type });
const repeat = <T,>(count: number, value: T) => Array.from({ length: count }, () => value);

test('a note takes at most 9 photos, 5 videos and 5 verification videos (same numbers as the server)', () => {
  assert.deepEqual(NOTE_MEDIA_TYPE_LIMITS, { photos: 9, videos: 5, verificationVideos: 5 });
});

test('each add button maps to one limit', () => {
  assert.equal(noteMediaLimitTypeFor('media', 'image'), 'photos');
  assert.equal(noteMediaLimitTypeFor('media', 'video'), 'videos');
  assert.equal(noteMediaLimitTypeFor('showcase', 'video'), 'verificationVideos');
});

test('remaining slots count what the note already has, never below zero', () => {
  const media = [...repeat(7, item('IMAGE')), ...repeat(2, item('VIDEO'))];
  const showcase = repeat(4, item('VIDEO'));
  assert.equal(remainingNoteMediaSlots('photos', media, showcase), 2);
  assert.equal(remainingNoteMediaSlots('videos', media, showcase), 3);
  assert.equal(remainingNoteMediaSlots('verificationVideos', media, showcase), 1);
  // 上限之前就超了的旧笔记:不能再加,但也不是负数。
  assert.equal(remainingNoteMediaSlots('photos', repeat(12, item('IMAGE')), []), 0);
});

test('a pick larger than the remaining slots keeps the first ones in picker order', () => {
  const picked = ['a', 'b', 'c', 'd'];
  assert.deepEqual(fitPickedAssetsToNoteMediaLimit(picked, 2), { kept: ['a', 'b'], dropped: ['c', 'd'] });
  assert.deepEqual(fitPickedAssetsToNoteMediaLimit(picked, 9), { kept: picked, dropped: [] });
  assert.deepEqual(fitPickedAssetsToNoteMediaLimit(picked, 0), { kept: [], dropped: picked });
});
