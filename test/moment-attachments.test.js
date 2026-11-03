const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

test('moment normalization preserves mixed attachment order and rejects unsafe media URLs', () => {
  const { normalizeMoment } = loadTsModule('src/services/api/moments.ts', { requireShim: (name) => {
    if (name === '@/services/api/client') return {};
    if (name === '@/services/api/utils') return { normalizeUserAvatarFrameAppearance: () => null, allowPeerMediaUrl: (url) => url?.startsWith('https://cdn.test/') ? url : null };
    if (name === './image-media') return { normalizeImageMedia: (images) => ({ images: images ?? [], media: [] }) };
    throw new Error(`unexpected import ${name}`);
  } });
  const result = normalizeMoment({ author: { avatarUrl: null }, comments: [], images: ['https://cdn.test/photo.jpg'], attachments: [
    { type: 'video', key: 'posts/me/clip.mp4', url: 'https://cdn.test/clip.mp4', posterUrl: 'https://evil.test/poster.jpg' },
    { type: 'image', key: 'posts/me/photo.jpg', url: 'https://cdn.test/photo.jpg' },
    { type: 'video', key: 'posts/me/clip2.mp4', url: 'https://cdn.test/clip2.mp4' },
    { type: 'video', url: 'https://evil.test/private.mp4' },
  ] });
  assert.deepEqual(Array.from(result.attachments, (item) => item.type), ['video', 'image', 'video']);
  assert.equal(result.attachments[0].posterUrl, undefined);
  assert.equal(result.images[0], 'https://cdn.test/photo.jpg');
});
