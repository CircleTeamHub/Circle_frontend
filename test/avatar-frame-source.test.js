const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadMembershipFrames() {
  const assetByPath = new Map();
  return {
    module: loadTsModule('src/features/profile/membership-frames.ts', {
      requireShim: (request) => {
        if (request === '@/features/profile/membership-plans') {
          return {
            getMembershipTierForVipLevel: (level) =>
              level === 3 ? 'diamond' : level >= 4 ? 'super' : null,
          };
        }
        if (request === '@/services/api/utils') {
          return {
            normalizeAvatarFrameImageUrl: (value) =>
              value?.startsWith('https://') ? value : null,
          };
        }
        if (request.endsWith('/assets/frames/diamond.png')) {
          const asset = { local: 'diamond' };
          assetByPath.set('diamond', asset);
          return asset;
        }
        if (request.endsWith('/assets/frames/super.png')) {
          const asset = { local: 'super' };
          assetByPath.set('super', asset);
          return asset;
        }
        throw new Error(`Unexpected import: ${request}`);
      },
    }),
    assetByPath,
  };
}

test('avatar frame source uses bundled assets for stable membership keys', () => {
  const { module, assetByPath } = loadMembershipFrames();

  assert.equal(
    module.getAvatarFrameSource({
      id: 'remote-id',
      key: 'membership-diamond',
      name: 'Diamond',
      imageUrl: 'https://cdn.example.com/changed.png',
    }),
    assetByPath.get('diamond'),
  );
  assert.equal(
    module.getAvatarFrameSource({
      id: 'remote-id-2',
      key: 'membership-super',
      name: 'Super',
      imageUrl: null,
    }),
    assetByPath.get('super'),
  );
});

test('avatar frame source uses a remote URI for unknown keys and null for no image', () => {
  const { module } = loadMembershipFrames();

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        module.getAvatarFrameSource({
          id: 'admin-frame',
          key: 'event-2026',
          name: 'Event',
          imageUrl: 'https://cdn.example.com/event.png',
        }),
      ),
    ),
    { uri: 'https://cdn.example.com/event.png' },
  );
  assert.equal(
    module.getAvatarFrameSource({
      id: 'admin-frame-empty',
      key: 'event-empty',
      name: 'Event',
      imageUrl: null,
    }),
    null,
  );
  assert.equal(module.getAvatarFrameSource(null), null);
  assert.equal(
    module.getAvatarFrameSource({
      id: 'unsafe-frame',
      key: 'unsafe',
      name: 'Unsafe',
      imageUrl: 'javascript:alert(1)',
    }),
    null,
  );
});

test('legacy vip-level frame resolver remains available during surface migration', () => {
  const { module, assetByPath } = loadMembershipFrames();
  assert.equal(module.getMembershipFrameAsset(3), assetByPath.get('diamond'));
  assert.equal(module.getMembershipFrameAsset(1), null);
});
