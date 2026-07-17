import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHAT_IMAGE_BYTES,
  isChatImageTooLarge,
} from './chat-media-policy.ts';

test('isChatImageTooLarge rejects images over the limit', () => {
  assert.equal(isChatImageTooLarge(MAX_CHAT_IMAGE_BYTES + 1), true);
});

test('isChatImageTooLarge accepts images at or under the limit', () => {
  assert.equal(isChatImageTooLarge(MAX_CHAT_IMAGE_BYTES), false);
  assert.equal(isChatImageTooLarge(1024), false);
});

test('isChatImageTooLarge lets an unknown size through', () => {
  // 部分相册资产不报 fileSize。此时放行（与头像/封面/照片的既有 gate 一致）——
  // 宁可放过一张大图，也不能因为元数据缺失就拦掉用户正常发图。
  assert.equal(isChatImageTooLarge(undefined), false);
  assert.equal(isChatImageTooLarge(null), false);
});

test('chat image limit matches the app-wide 10MB image ceiling', () => {
  assert.equal(MAX_CHAT_IMAGE_BYTES, 10 * 1024 * 1024);
});
