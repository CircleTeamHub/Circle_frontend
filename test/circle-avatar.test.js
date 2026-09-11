const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle avatar: API + upload hook are wired', () => {
  const api = read('src/services/api/circles.ts');
  assert.match(api, /export async function setCircleAvatar/);
  assert.match(api, /\/circle\/\$\{id\}\/avatar/);

  // 圈子头像与群头像共用一个 hook:原来是两份逐字复制的 115 行,复制的那份
  // 失败提示还写死成「网络错误」。落库端点由调用方以 submit 传进来。
  const hook = read('src/hooks/use-change-avatar.ts');
  assert.match(hook, /folder: 'avatars'/);
  assert.match(hook, /await submit\(fileUrl\);/);
  assert.ok(
    !fs.existsSync(
      path.join(process.cwd(), 'src/features/discover/hooks/use-change-circle-avatar.ts'),
    ) &&
      !fs.existsSync(
        path.join(process.cwd(), 'src/features/chat/hooks/use-change-group-avatar.ts'),
      ),
    'the duplicated avatar hooks must be gone, not left behind as a second copy',
  );

  const screen = read('src/features/discover/screens/CircleDetailScreen.tsx');
  assert.match(screen, /await setCircleAvatar\(id, fileUrl\)/);
});

test('CircleDetailScreen: avatar is tappable only for the owner to change it', () => {
  const src = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );
  assert.match(src, /useChangeAvatar\(\{/);
  assert.match(src, /const isOwner = circle\?\.myRole === 'OWNER'/);
  // the avatar wrapper is a Pressable gated on ownership, not admin status.
  assert.match(
    src,
    /onPress=\{isOwner \? changeCircleAvatar : undefined\}/,
  );
});

test('changing avatar/cover syncs the cached circle lists', () => {
  const store = read('src/features/discover/store/use-circles-store.ts');
  assert.match(store, /patchCircle: \(id, patch\)/);

  const screen = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );
  assert.match(screen, /patchCircle\(id, \{ avatarUrl: url \}\)/);
  assert.match(screen, /patchCircle\(id, \{ cover: url \}\)/);
});
