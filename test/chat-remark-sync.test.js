const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('friendRemarkStore exposes a remark override map with set/reset', () => {
  const source = read('src/stores/friendRemarkStore.ts');

  assert.match(source, /remarks: Record<string, string>/);
  assert.match(source, /setRemark: \(userID: string, remark: string \| null\)/);
  assert.match(source, /reset: \(\) => set\(\{ remarks: \{\} \}\)/);
});

test('EditFriendRemarkScreen broadcasts the new remark after a successful save', () => {
  const source = read('src/features/user/screens/EditFriendRemarkScreen.tsx');

  // 必须在 setFriendRemark 之后、router.back 之前写入 store，订阅方才能即时刷新。
  assert.match(
    source,
    /await setFriendRemark\(profileId, value\);[\s\S]*useFriendRemarkStore\.getState\(\)\.setRemark\(profileId, value\);[\s\S]*router\.back\(\);/,
  );
});

test('ChatDetailScreen derives the single-chat title reactively from the remark override', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');

  // 标题不再直接等于 params.title；群聊不吃备注，单聊覆盖优先、参数作 fallback。
  assert.match(source, /useFriendRemarkStore\(\(state\) =>/);
  assert.match(source, /isGroupChat \? undefined : state\.remarks\[sourceID\]/);
  assert.match(
    source,
    /remarkOverride && remarkOverride\.length > 0 \? remarkOverride : paramTitle/,
  );
});

test('logout resets the friend remark override store to avoid cross-account name bleed', () => {
  const source = read('src/services/auth/session.ts');

  assert.match(source, /useFriendRemarkStore\.getState\(\)\.reset\(\);/);
});
