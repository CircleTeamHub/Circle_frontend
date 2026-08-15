const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Avatar uses one gray WeChat-style silhouette when no image is configured', () => {
  const avatar = read('src/components/ui/avatar.tsx');

  assert.match(avatar, /DEFAULT_AVATAR_BACKGROUND = '#D8D8D8'/);
  assert.match(avatar, /DEFAULT_AVATAR_FOREGROUND = '#F5F5F5'/);
  assert.match(avatar, /function DefaultAvatar/);
  assert.match(avatar, /<Circle[\s\S]*?<Path/);
  assert.doesNotMatch(avatar, /\(name && name\[0\]\)|>\?\s*</);
});

test('the custom user profile hero reuses Avatar instead of drawing initials', () => {
  const profile = read('src/features/user/screens/UserProfileScreen.tsx');

  assert.match(profile, /<Avatar[\s\S]*?size=\{AVATAR_SIZE\}/);
  assert.doesNotMatch(profile, /avatarFallback|profile\.name\.charAt\(0\)/);
});

test('user avatars default to rounded squares while My profile stays circular', () => {
  const avatar = read('src/components/ui/avatar.tsx');
  const myProfile = read('src/features/profile/screens/ProfileScreen.tsx');
  const userProfile = read('src/features/user/screens/UserProfileScreen.tsx');

  assert.match(avatar, /shape = 'square'/);
  assert.match(avatar, /borderCurve: 'continuous'/);
  assert.match(
    myProfile,
    /<Avatar[\s\S]*?size=\{56\}[\s\S]*?shape="circle"[\s\S]*?compactFrame/,
  );
  assert.match(userProfile, /avatarRing:[\s\S]*?borderRadius: Radius\.md/);
  assert.doesNotMatch(
    userProfile,
    /<Avatar[\s\S]*?size=\{AVATAR_SIZE\}[\s\S]*?shape="circle"/,
  );
});

test('My avatar-frame previews remain circular so circular frames still fit', () => {
  for (const rel of [
    'src/features/profile/screens/AvatarFramesScreen.tsx',
    'src/features/profile/screens/AvatarFrameDetailScreen.tsx',
  ]) {
    assert.match(
      read(rel),
      /<Avatar[\s\S]*?shape="circle"[\s\S]*?frameSource=/,
      `${rel} should keep its frame preview circular`,
    );
  }
});
