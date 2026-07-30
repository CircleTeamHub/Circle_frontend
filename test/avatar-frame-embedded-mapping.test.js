const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadTsModule } = require('./helpers/load-ts-module');

const rawFrame = {
  id: 'frame-1',
  key: 'membership-diamond',
  name: 'Diamond',
  imageUrl: 'http://localhost:9000/frames/diamond.png',
};

function normalizeAvatarFrameAppearance(value) {
  return value ? { ...value, imageUrl: `frame:${value.imageUrl}` } : null;
}

function apiUtilsShim() {
  return {
    buildQuery: () => '',
    fetchCountEndpoint: async () => 0,
    normalizeMediaUrl: (value) =>
      typeof value === 'string' ? `media:${value}` : value ?? null,
    normalizeAvatarFrameAppearance,
    normalizeUserAvatarFrameAppearance: (value, vipLevel) => {
      if (value !== undefined) return normalizeAvatarFrameAppearance(value);
      if (vipLevel === 3) {
        return {
          id: 'legacy-membership-diamond',
          key: 'membership-diamond',
          name: 'Diamond membership frame',
          imageUrl: null,
        };
      }
      if (typeof vipLevel === 'number' && vipLevel >= 4) {
        return {
          id: 'legacy-membership-super',
          key: 'membership-super',
          name: 'Super membership frame',
          imageUrl: null,
        };
      }
      return null;
    },
  };
}

test('public user API preserves normalized avatarFrameAppearance and nulls missing legacy avatarFrame', async () => {
  const users = loadTsModule('src/services/api/users.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: async () => ({
            id: 'user-1',
            accountId: 'alice',
            nickname: 'Alice',
            avatarUrl: null,
            avatarFrameAppearance: rawFrame,
          }),
        };
      }
      if (request === '@/services/api/utils') return apiUtilsShim();
      throw new Error(`Unexpected import: ${request}`);
    },
  });

  const user = await users.searchUsersByAccountId('alice');

  assert.equal(user.avatarFrame, null);
  assert.equal(user.avatarFrameAppearance.imageUrl, `frame:${rawFrame.imageUrl}`);
});

test('friend API preserves normalized avatarFrameAppearance', async () => {
  const friends = loadTsModule('src/services/api/friends.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: async () => [
            {
              id: 'user-1',
              accountId: 'alice',
              nickname: 'Alice',
              avatarUrl: null,
              gender: 'unset',
              lastOnline: null,
              friendsSince: '2026-07-01T00:00:00.000Z',
              remark: null,
              avatarFrameAppearance: rawFrame,
            },
          ],
        };
      }
      if (request === '@/services/api/utils') return apiUtilsShim();
      throw new Error(`Unexpected import: ${request}`);
    },
  });

  const result = await friends.fetchFriends();

  assert.equal(
    result[0].avatarFrameAppearance.imageUrl,
    `frame:${rawFrame.imageUrl}`,
  );
});

test('moment feed author preserves normalized avatarFrameAppearance', async () => {
  const moments = loadTsModule('src/services/api/moments.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: async () => ({
            id: 'moment-1',
            content: '',
            images: [],
            author: {
              id: 'user-1',
              nickname: 'Alice',
              avatarUrl: null,
              avatarFrameAppearance: rawFrame,
            },
            comments: [],
          }),
        };
      }
      if (request === '@/services/api/utils') return apiUtilsShim();
      throw new Error(`Unexpected import: ${request}`);
    },
  });

  const result = await moments.fetchMomentById('moment-1');

  assert.equal(
    result.author.avatarFrameAppearance.imageUrl,
    `frame:${rawFrame.imageUrl}`,
  );
});

test('plaza feed author preserves normalized avatarFrameAppearance', async () => {
  const plaza = loadTsModule('src/services/api/plaza.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: async () => ({
            id: 'post-1',
            images: [],
            expiresAt: null,
            author: {
              id: 'user-1',
              accountId: 'alice',
              nickname: 'Alice',
              avatarUrl: null,
              displayIcons: [],
              avatarFrameAppearance: rawFrame,
            },
          }),
        };
      }
      if (request === '@/services/api/utils') return apiUtilsShim();
      throw new Error(`Unexpected import: ${request}`);
    },
  });

  const result = await plaza.fetchPlazaPost('post-1');

  assert.equal(result.author.avatarFrame, null);
  assert.equal(
    result.author.avatarFrameAppearance.imageUrl,
    `frame:${rawFrame.imageUrl}`,
  );
});

test('legacy author payloads fall back to membership frames but explicit null stays unequipped', async () => {
  const responses = [
    {
      id: 'moment-legacy',
      content: '',
      images: [],
      author: {
        id: 'user-legacy',
        nickname: 'Legacy Diamond',
        avatarUrl: null,
        vipLevel: 3,
      },
      comments: [],
    },
    {
      id: 'moment-unequipped',
      content: '',
      images: [],
      author: {
        id: 'user-unequipped',
        nickname: 'Unequipped Super',
        avatarUrl: null,
        vipLevel: 4,
        avatarFrameAppearance: null,
      },
      comments: [],
    },
  ];
  const moments = loadTsModule('src/services/api/moments.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: async () => ({
            items: responses,
            nextCursor: null,
          }),
        };
      }
      if (request === '@/services/api/utils') return apiUtilsShim();
      throw new Error(`Unexpected import: ${request}`);
    },
  });

  const result = await moments.fetchMomentsFeed();

  assert.equal(
    result.items[0].author.avatarFrameAppearance.key,
    'membership-diamond',
  );
  assert.equal(result.items[1].author.avatarFrameAppearance, null);
});

test('normalized app-facing user and feed types require explicit frame appearance nullability', () => {
  const authStore = fs.readFileSync('src/stores/authStore.ts', 'utf8');
  const friends = fs.readFileSync('src/services/api/friends.ts', 'utf8');
  const types = fs.readFileSync('src/types/index.ts', 'utf8');

  assert.match(
    authStore,
    /avatarFrameAppearance: AvatarFrameAppearance \| null;/,
  );
  assert.doesNotMatch(
    authStore,
    /avatarFrameAppearance\?: AvatarFrameAppearance \| null;/,
  );
  assert.match(
    friends,
    /avatarFrameAppearance: AvatarFrameAppearance \| null;/,
  );
  assert.match(
    types,
    /avatarFrameAppearance: AvatarFrameAppearance \| null;/,
  );
});
