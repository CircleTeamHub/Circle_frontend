const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('avatar frames and fancy numbers are disabled by frontend rollout flags', () => {
  const flags = read('src/constants/feature-flags.ts');

  assert.match(flags, /avatarFrames:\s*false/);
  assert.match(flags, /fancyNumbers:\s*false/);
});

test('hidden cosmetic routes redirect before mounting feature screens', () => {
  for (const relativePath of [
    'app/(tabs)/profile/avatar-frames.tsx',
    'app/(tabs)/profile/avatar-frame/[id].tsx',
    'app/(tabs)/profile/fancy-number.tsx',
  ]) {
    const route = read(relativePath);
    assert.match(route, /FEATURE_FLAGS\.(avatarFrames|fancyNumbers)/);
    assert.match(route, /<Redirect href="\/\(tabs\)\/profile"/);
  }
});

test('all frontend entry points and avatar rendering honor the rollout flags', () => {
  const expectedFlagBySurface = new Map([
    ['src/components/ui/avatar.tsx', 'avatarFrames'],
    ['src/features/user/screens/UserProfileScreen.tsx', 'avatarFrames'],
    ['src/features/profile/screens/MyDecorationsScreen.tsx', 'avatarFrames'],
    ['src/features/profile/screens/MallScreen.tsx', 'avatarFrames'],
    ['src/features/profile/screens/ProfileScreen.tsx', 'fancyNumbers'],
    ['src/features/profile/screens/MemberCenterScreen.tsx', 'fancyNumbers'],
    ['src/features/social/screens/CreatePostScreen.tsx', 'fancyNumbers'],
    ['src/features/discover/components/restriction-badge.tsx', 'fancyNumbers'],
    ['src/features/discover/components/plaza-post-card.tsx', 'fancyNumbers'],
  ]);

  for (const [relativePath, flag] of expectedFlagBySurface) {
    assert.match(
      read(relativePath),
      new RegExp(`FEATURE_FLAGS\\.${flag}`),
      `${relativePath} must honor ${flag}`,
    );
  }

  assert.match(
    read('src/features/profile/screens/MallScreen.tsx'),
    /FEATURE_FLAGS\.fancyNumbers/,
  );
  assert.match(
    read('src/features/profile/screens/MemberRulesScreen.tsx'),
    /FEATURE_FLAGS\.avatarFrames/,
  );
});

test('backend-facing avatar-frame and fancy-number API modules remain available', () => {
  const avatarFramesApi = read('src/services/api/avatar-frames.ts');
  const fancyNumberApi = read('src/services/api/fancy-number.ts');

  assert.match(avatarFramesApi, /export async function fetchAvatarFrameInventory/);
  assert.match(avatarFramesApi, /export async function equipAvatarFrame/);
  assert.match(fancyNumberApi, /export async function fetchFancyNumbers/);
  assert.match(fancyNumberApi, /export async function purchaseFancyNumber/);
});
