const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('profile API no longer exposes profile-like mutations for Top Collaborator', () => {
  const api = read('src/services/api/profile.ts');

  assert.doesNotMatch(api, /export async function likeUser/);
  assert.doesNotMatch(api, /export async function unlikeUser/);
  assert.doesNotMatch(api, /\/user\/\$\{userId\}\/like/);
});

test('normalizeUser preserves collaboration recognition progress without profile-like state', () => {
  const auth = read('src/services/api/auth.ts');
  const utils = read('src/services/api/utils.ts');

  assert.match(auth, /likeCount\?: number/);
  assert.match(auth, /receivedLikeCount\?: number/);
  assert.match(auth, /recognitionCount\?: number/);
  assert.match(
    utils,
    /likeCount: user\.likeCount \?\? user\.receivedLikeCount \?\? 0/,
  );
  assert.match(utils, /recognitionCount: user\.recognitionCount \?\? 0/);
  assert.doesNotMatch(utils, /likedByMeToday/);
});

test('UserProfileScreen does not keep the old top-right profile-like button', () => {
  const screen = read('src/features/user/screens/UserProfileScreen.tsx');

  assert.doesNotMatch(screen, /handleToggleLike/);
  assert.doesNotMatch(screen, /unlikeUser\(profileId\)/);
  assert.doesNotMatch(screen, /likeUser\(profileId\)/);
  assert.doesNotMatch(screen, /LIKE_ICON/);
  assert.doesNotMatch(screen, /assets\/profile\/Thumbs up\.png/);
  assert.doesNotMatch(screen, /const \[likeStatus, setLikeStatus\]/);
  assert.doesNotMatch(screen, /function formatLikeCount/);
});

test('NavHeader still supports a custom rightSlot for other screens', () => {
  const nav = read('src/components/ui/nav-header.tsx');

  assert.match(nav, /rightSlot\?: ReactNode/);
  assert.match(nav, /\{rightSlot \?/);
});
