const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('profile API 暴露 likeUser/unlikeUser，打 POST/DELETE /user/:id/like', () => {
  const api = read('src/services/api/profile.ts');
  assert.match(api, /export async function likeUser/);
  assert.match(api, /export async function unlikeUser/);
  assert.match(api, /\/user\/\$\{userId\}\/like/);
  assert.match(api, /method: 'POST'/);
  assert.match(api, /method: 'DELETE'/);
});

test('normalizeUser 透传 likeCount/likedByMeToday（/me 用 receivedLikeCount 兜底）', () => {
  const utils = read('src/services/api/utils.ts');
  assert.match(
    utils,
    /likeCount: user\.likeCount \?\? user\.receivedLikeCount \?\? 0/,
  );
  assert.match(utils, /likedByMeToday: user\.likedByMeToday \?\? false/);
});

test('UserProfileScreen 右上角点赞按钮：看别人可点+乐观更新，看自己只显示数', () => {
  const screen = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(screen, /handleToggleLike/);
  assert.match(screen, /unlikeUser\(profileId\)/);
  assert.match(screen, /likeUser\(profileId\)/);
  // 看自己不可点（自赞无意义）
  assert.match(screen, /isCurrentUser \? undefined : handleToggleLike/);
  assert.match(screen, /disabled=\{isCurrentUser \|\| liking\}/);
  // 心形图标随状态切换，放进 NavHeader 右侧插槽
  assert.match(screen, /rightSlot=/);
  assert.match(screen, /likedByMeToday \? 'thumbs-up' : 'thumbs-up-outline'/);
});

test('NavHeader 支持自定义 rightSlot（图标+文字复合按钮）', () => {
  const nav = read('src/components/ui/nav-header.tsx');
  assert.match(nav, /rightSlot\?: ReactNode/);
  assert.match(nav, /\{rightSlot \?/);
});

test('点赞数 ≥1万缩写为「万」并应用到胶囊，避免大数字撑爆', () => {
  const screen = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(screen, /function formatLikeCount/);
  assert.match(screen, /n < 10000/);
  assert.match(screen, /万/);
  assert.match(screen, /formatLikeCount\(likeStatus\.likeCount/);
  // 中英双语缩写
  assert.match(screen, /language\.startsWith\('zh'\)/);
  assert.match(screen, /\}k`|'k'|\}M`/);
});
