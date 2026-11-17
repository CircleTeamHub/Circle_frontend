const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadMomentsApi(response) {
  return loadTsModule('src/services/api/moments.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return { apiClient: async () => response };
      }
      if (request === '@/services/api/utils') {
        return {
          buildQuery: () => '',
          allowPeerMediaUrl: (value) => value,
          normalizeUserAvatarFrameAppearance: () => null,
        };
      }
      if (request === './image-media') {
        return {
          normalizeImageMedia: () => ({ images: [], media: [] }),
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  });
}

const feed = (snapshotAt) => ({
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  hasMore: false,
  nextCursor: null,
  snapshotAt,
});

test('moments feed preserves a canonical server snapshot', async () => {
  const snapshotAt = '2026-11-17T08:20:00.123Z';
  const api = loadMomentsApi(feed(snapshotAt));
  assert.equal((await api.fetchMomentsFeed()).snapshotAt, snapshotAt);
});

for (const snapshotAt of [undefined, null, '', 'invalid', 123, '2026-02-30T00:00:00.000Z']) {
  test(`old or malformed moments snapshot is normalized to null: ${snapshotAt}`, async () => {
    const api = loadMomentsApi(feed(snapshotAt));
    assert.equal((await api.fetchMomentsFeed()).snapshotAt, null);
  });
}
