import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFunction } from 'i18next';
import { buildNoteMeta, splitNoteVideoCounts } from './note-format.ts';

// Renders each key's zh default with its count, like the app does without a translation.
const t = ((_key: string, options: { defaultValue: string }) => options.defaultValue) as unknown as TFunction;

const updatedAt = '2026-11-05T04:28:00.000Z';
const meta = (counts: { imageCount: number; videoCount: number; showcaseCount?: number }) =>
  buildNoteMeta({ updatedAt, ...counts }, t).split(' | ').slice(1);

test('verification videos are counted once, after images and videos', () => {
  // Verification videos are saved in the same media list, so videoCount includes them.
  assert.deepEqual(meta({ imageCount: 2, videoCount: 3, showcaseCount: 1 }), ['2图片', '2视频', '1验证']);
});

test('a note whose only videos are verification videos shows no plain video count', () => {
  assert.deepEqual(meta({ imageCount: 0, videoCount: 2, showcaseCount: 2 }), ['2验证']);
});

test('older summaries without showcaseCount keep the plain counts', () => {
  assert.deepEqual(meta({ imageCount: 1, videoCount: 1 }), ['1图片', '1视频']);
  assert.deepEqual(splitNoteVideoCounts(1), { videos: 1, verifications: 0 });
});
