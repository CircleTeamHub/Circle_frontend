const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('friendRemarkStore exposes a remark override map with set/reset', () => {
  const source = read('src/stores/friendRemarkStore.ts');

  assert.match(source, /export type FriendRemarkOverride = \{/);
  assert.match(source, /remark: string \| null/);
  assert.match(source, /fallbackName\?: string/);
  assert.match(source, /remarks: Record<string, FriendRemarkOverride \| undefined>/);
  assert.match(source, /fallbackName\?: string \| null/);
  assert.match(source, /reset: \(\) => set\(\{ remarks: \{\} \}\)/);
});

test('EditFriendRemarkScreen broadcasts the new remark after a successful save', () => {
  const source = read('src/features/user/screens/EditFriendRemarkScreen.tsx');

  // 必须在 setFriendRemark 之后、router.back 之前写入 store，订阅方才能即时刷新。
  assert.match(
    source,
    /await setFriendRemark\(profileId, value\);[\s\S]*if \(!mountedRef\.current\) return;[\s\S]*useFriendRemarkStore\.getState\(\)\.setRemark\(profileId, value, remarkFallbackName\);[\s\S]*router\.back\(\);/,
  );
  assert.match(source, /if \(mountedRef\.current\) setIsSaving\(false\)/);
});

test('ChatDetailScreen derives the single-chat title reactively from the remark override', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');

  // 标题不再直接等于 params.title；群聊不吃备注，单聊覆盖优先、参数作 fallback。
  assert.match(source, /useFriendRemarkStore\(\(state\) =>/);
  assert.match(source, /isGroupChat \? undefined : state\.remarks\[sourceID\]/);
  assert.match(
    source,
    /remarkOverride\.remark \?\? remarkOverride\.fallbackName \?\? paramTitle/,
  );
});

test('UserProfileScreen derives friend display fields from the reactive remark override', () => {
  const source = read('src/features/user/screens/UserProfileScreen.tsx');

  assert.match(source, /useFriendRemarkStore\(\(state\) =>/);
  assert.match(source, /state\.remarks\[profileId\]/);
  assert.match(source, /remarkOverride === undefined/);
  assert.match(
    source,
    /remarkOverride\.remark \?\? remarkOverride\.fallbackName \?\? profile\.name/,
  );
  assert.match(source, /remarkOverride\.remark \?\? t\('profileFields\.notSet'\)/);
});

test('logout resets the friend remark override store to avoid cross-account name bleed', () => {
  const source = read('src/services/auth/session.ts');

  assert.match(source, /useFriendRemarkStore\.getState\(\)\.reset\(\);/);
});
