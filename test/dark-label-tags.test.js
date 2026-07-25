const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('discover plaza badges use solid dark fills instead of translucent fills', () => {
  const restrictionBadge = read('src/features/discover/components/restriction-badge.tsx');
  const plazaPostCard = read('src/features/discover/components/plaza-post-card.tsx');

  assert.match(restrictionBadge, /backgroundColor:\s*b\.color/);
  assert.match(restrictionBadge, /color=\{colors\.white\}/);
  assert.doesNotMatch(restrictionBadge, /\$\{b\.color\}20/);
  assert.match(plazaPostCard, /tag:\s*\{\s*backgroundColor:\s*colors\.primary/);
  assert.match(plazaPostCard, /tagText:\s*\{\s*color:\s*colors\.white/);
  assert.match(plazaPostCard, /backgroundColor:\s*OPEN_BADGE_COLOR/);
  assert.doesNotMatch(plazaPostCard, /\$\{OPEN_BADGE_COLOR\}20/);
});

test('profile and user profile labels use solid fills', () => {
  const profile = read('src/features/profile/screens/ProfileScreen.tsx');
  const loginDevices = read('src/features/profile/screens/LoginDeviceManagementScreen.tsx');
  const memberStatBlock = profile.match(/memberStat:\s*\{[\s\S]*?\n      \},/)?.[0] ?? '';

  assert.doesNotMatch(profile, /memberTagBgLight/);
  assert.match(memberStatBlock, /borderColor:/);
  assert.doesNotMatch(memberStatBlock, /backgroundColor:\s*colors\.memberTagBg/);
  assert.match(profile, /memberIdentityCircle:\s*\{\s*backgroundColor:\s*colors\.memberTagBg/);
  assert.match(profile, /memberStatValue:\s*\{\s*color:\s*colors\.white/);
  assert.match(loginDevices, /badge:\s*\{\s*backgroundColor:\s*colors\.primary/);
  assert.match(loginDevices, /badgeText:\s*\{\s*color:\s*colors\.white/);
});

test('profile member identity fill uses violet indigo instead of brown', () => {
  const colors = read('src/theme/colors.ts');

  assert.match(colors, /memberTagBg:\s*'#312E81'/);
  assert.match(colors, /memberTagBgLight:\s*'rgba\(49, 46, 129, 0\.33\)'/);
  assert.doesNotMatch(colors, /memberTagBg:\s*'#3D2E1A'/);
  assert.doesNotMatch(colors, /rgba\(61, 46, 26, 0\.33\)/);
});

test('selected tag and chip controls use solid primary fills', () => {
  const files = [
    'src/features/user/screens/EditFriendTagsScreen.tsx',
    'src/features/social/screens/SendFriendRequestScreen.tsx',
    'src/features/profile/screens/CollectionsScreen.tsx',
    'src/features/profile/screens/MyIconsScreen.tsx',
  ];

  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /primaryLight/, `${file} should not use translucent selected tags`);
    assert.match(src, /backgroundColor:\s*colors\.primary/, `${file} should use a solid selected fill`);
  }
});

test('discover tag chips use solid primary or semantic fills', () => {
  const files = [
    'src/features/discover/components/circle-form-body.tsx',
    'src/features/discover/screens/CircleDetailScreen.tsx',
    'src/features/discover/screens/FilterScreen.tsx',
    'src/features/discover/screens/SelectCityScreen.tsx',
    'src/features/social/screens/CreatePostScreen.tsx',
    'src/features/discover/screens/AdminReviewScreen.tsx',
    'src/features/discover/components/moments-feed.tsx',
    'src/features/notifications/components/ReadFilterBar.tsx',
  ];

  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /primaryLight|#[0-9A-Fa-f]{6}20/, `${file} should not use translucent tag fills`);
    assert.match(src, /backgroundColor:\s*(?:on \? )?colors\.primary|backgroundColor:\s*'#F59E0B'/, `${file} should use a solid fill`);
  }
});
