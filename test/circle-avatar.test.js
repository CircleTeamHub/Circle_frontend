const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle avatar: API + upload hook are wired', () => {
  const api = read('src/services/api/circles.ts');
  assert.match(api, /export async function setCircleAvatar/);
  assert.match(api, /\/circle\/\$\{id\}\/avatar/);

  const hook = read(
    'src/features/discover/hooks/use-change-circle-avatar.ts',
  );
  assert.match(hook, /setCircleAvatar\(circleId, fileUrl\)/);
  assert.match(hook, /folder: 'avatars'/);
});

test('CircleDetailScreen: avatar is tappable for the owner to change it', () => {
  const src = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );
  assert.match(src, /useChangeCircleAvatar/);
  // the avatar wrapper is a Pressable gated on ownership
  assert.match(
    src,
    /onPress=\{isOwnerOrAdmin \? changeCircleAvatar : undefined\}/,
  );
});
