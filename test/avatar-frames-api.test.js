const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadAvatarFramesApi(apiClient) {
  return loadTsModule('src/services/api/avatar-frames.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return { apiClient };
      }
      if (request === '@/services/api/utils') {
        return {
          normalizeAvatarFrameImageUrl: (value) => {
            if (value === null || typeof value === 'undefined') return null;
            if (
              value.startsWith('https://') ||
              value.startsWith('http://localhost:')
            ) {
              return `normalized:${value}`;
            }
            return null;
          },
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  });
}

const inventoryResponse = {
  equippedFrameId: 'frame-diamond',
  items: [
    {
      id: 'frame-diamond',
      key: 'membership-diamond',
      name: 'Diamond',
      description: 'Diamond membership frame',
      imageUrl: 'http://localhost:9000/frames/diamond.png',
      minimumVipLevel: 3,
      ownedSources: [
        {
          type: 'MEMBERSHIP',
          minimumVipLevel: 3,
          expiresAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      availableUntil: '2026-08-01T00:00:00.000Z',
      equipped: true,
    },
  ],
};

test('avatar-frame inventory maps remote image URLs and preserves nullable fields', async () => {
  const calls = [];
  const api = loadAvatarFramesApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return inventoryResponse;
  });

  const result = await api.fetchAvatarFrameInventory();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { endpoint: '/avatar-frames/me' },
  ]);
  assert.equal(
    result.items[0].imageUrl,
    'normalized:http://localhost:9000/frames/diamond.png',
  );
  assert.equal(result.items[0].availableUntil, '2026-08-01T00:00:00.000Z');
  assert.equal(result.items[0].ownedSources[0].expiresAt, '2026-08-01T00:00:00.000Z');
});

test('equipAvatarFrame sends null unchanged to unequip and validates the returned inventory', async () => {
  const calls = [];
  const api = loadAvatarFramesApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { equippedFrameId: null, items: [] };
  });

  const result = await api.equipAvatarFrame(null);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/avatar-frames/me/equipped',
      options: { method: 'PUT', body: { frameId: null } },
    },
  ]);
  assert.equal(result.equippedFrameId, null);
});

test('fetchUserAppearances maps frame URLs and preserves explicit null appearances', async () => {
  const calls = [];
  const api = loadAvatarFramesApi(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {
      alice: {
        vipLevel: 3,
        avatarFrame: {
          id: 'frame-diamond',
          key: 'membership-diamond',
          name: 'Diamond',
          imageUrl: 'http://localhost:9000/frames/diamond.png',
        },
      },
      bob: { vipLevel: 0, avatarFrame: null },
    };
  });

  const result = await api.fetchUserAppearances(['alice', 'bob']);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/user/appearances',
      options: { method: 'POST', body: { ids: ['alice', 'bob'] } },
    },
  ]);
  assert.equal(
    result.alice.avatarFrame.imageUrl,
    'normalized:http://localhost:9000/frames/diamond.png',
  );
  assert.equal(result.bob.avatarFrame, null);
});

test('avatar-frame APIs reject malformed authoritative responses', async (t) => {
  const malformedCases = [
    ['inventory root', null, 'inventory'],
    [
      'inventory item',
      { equippedFrameId: null, items: [{ ...inventoryResponse.items[0], equipped: 'yes' }] },
      'inventory',
    ],
    [
      'owned source',
      {
        equippedFrameId: null,
        items: [
          {
            ...inventoryResponse.items[0],
            ownedSources: [{ type: 'MEMBERSHIP', expiresAt: null }],
          },
        ],
      },
      'inventory',
    ],
    ['batch root', [], 'batch'],
    [
      'out-of-range minimum vip level',
      {
        equippedFrameId: null,
        items: [{ ...inventoryResponse.items[0], minimumVipLevel: 0 }],
      },
      'inventory',
    ],
    [
      'invalid available-until timestamp',
      {
        equippedFrameId: null,
        items: [{ ...inventoryResponse.items[0], availableUntil: 'tomorrow' }],
      },
      'inventory',
    ],
    [
      'invalid owned-source expiry',
      {
        equippedFrameId: null,
        items: [
          {
            ...inventoryResponse.items[0],
            ownedSources: [
              {
                type: 'MEMBERSHIP',
                minimumVipLevel: 3,
                expiresAt: 'not-an-iso-date',
              },
            ],
          },
        ],
      },
      'inventory',
    ],
    [
      'unsafe authoritative image URL',
      {
        equippedFrameId: null,
        items: [
          {
            ...inventoryResponse.items[0],
            imageUrl: 'javascript:alert(1)',
          },
        ],
      },
      'inventory',
    ],
    [
      'equipped id missing from inventory',
      {
        equippedFrameId: 'missing',
        items: [{ ...inventoryResponse.items[0], equipped: false }],
      },
      'inventory',
    ],
    [
      'equipped id not marked equipped',
      {
        equippedFrameId: 'frame-diamond',
        items: [{ ...inventoryResponse.items[0], equipped: false }],
      },
      'inventory',
    ],
    [
      'item marked equipped while equipped id is null',
      {
        equippedFrameId: null,
        items: [{ ...inventoryResponse.items[0], equipped: true }],
      },
      'inventory',
    ],
    [
      'duplicate inventory ids',
      {
        equippedFrameId: 'frame-diamond',
        items: [
          inventoryResponse.items[0],
          {
            ...inventoryResponse.items[0],
            key: 'duplicate-frame',
            equipped: false,
          },
        ],
      },
      'inventory',
    ],
  ];

  for (const [name, response, kind] of malformedCases) {
    await t.test(name, async () => {
      const api = loadAvatarFramesApi(async () => response);
      await assert.rejects(
        kind === 'batch'
          ? api.fetchUserAppearances(['alice'])
          : api.fetchAvatarFrameInventory(),
        /Malformed/,
      );
    });
  }
});

test('malformed appearance entries are isolated while valid siblings survive', async () => {
  const api = loadAvatarFramesApi(async () => ({
    alice: { vipLevel: 3, avatarFrame: null },
    bob: { vipLevel: 'bad', avatarFrame: null },
  }));

  const result = await api.fetchUserAppearances(['alice', 'bob']);

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { alice: { vipLevel: 3, avatarFrame: null } },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.getInvalidUserAppearanceIds(result))),
    ['bob'],
  );
});

test('fetchUserAppearances short-circuits an empty request', async () => {
  let calls = 0;
  const api = loadAvatarFramesApi(async () => {
    calls += 1;
    return {};
  });

  const result = await api.fetchUserAppearances([]);

  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {});
});

test('avatar-frame inventory contracts live in shared types rather than the API module', () => {
  const types = fs.readFileSync('src/types/index.ts', 'utf8');
  const api = fs.readFileSync('src/services/api/avatar-frames.ts', 'utf8');

  assert.match(types, /export interface AvatarFrameInventory\s*\{/);
  assert.match(types, /export interface AvatarFrameInventoryItem/);
  assert.match(types, /export type AvatarFrameOwnedSource/);
  assert.doesNotMatch(api, /interface AvatarFrameInventory\s*\{/);
  assert.match(api, /AvatarFrameInventory,/);
});
