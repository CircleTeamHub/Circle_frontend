const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadImageMedia() {
  return loadTsModule('src/services/api/image-media.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/utils') {
        return {
          normalizeMediaUrl: (value) =>
            typeof value === 'string'
              ? value.replace('http://localhost', 'https://cdn.example')
              : value,
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  });
}

test('normalizes thumb and original media while keeping a legacy image fallback', () => {
  const { normalizeImageMedia } = loadImageMedia();
  const result = normalizeImageMedia(
    ['http://localhost/original.jpg'],
    [
      {
        thumbUrl: 'http://localhost/thumb.jpg',
        originalUrl: 'http://localhost/original.jpg',
        key: 'images/1/original.jpg',
        thumbKey: 'images/1/thumb.jpg',
        width: 1600,
        height: 1200,
      },
    ],
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    images: ['https://cdn.example/original.jpg'],
    media: [
      {
        thumb: 'https://cdn.example/thumb.jpg',
        thumbUrl: 'https://cdn.example/thumb.jpg',
        original: 'https://cdn.example/original.jpg',
        originalUrl: 'https://cdn.example/original.jpg',
        key: 'images/1/original.jpg',
        thumbKey: 'images/1/thumb.jpg',
        width: 1600,
        height: 1200,
      },
    ],
  });
});

test('supports a media-only response for rolling backend deployments', () => {
  const { normalizeImageMedia } = loadImageMedia();
  const result = normalizeImageMedia(undefined, [
    { thumb: 'http://localhost/thumb.jpg', key: 'images/2/thumb.jpg' },
  ]);

  assert.equal(result.images[0], 'https://cdn.example/thumb.jpg');
  assert.equal(result.media[0].thumbUrl, 'https://cdn.example/thumb.jpg');
  assert.equal(result.media[0].key, 'images/2/thumb.jpg');
});
