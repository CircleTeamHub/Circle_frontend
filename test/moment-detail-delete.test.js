const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/discover/screens/MomentDetailScreen.tsx';

test('MomentDetailScreen uses the shared delete action and leaves after deletion', () => {
  const src = read(SRC);

  assert.match(src, /confirmDeleteMoment\(post, t, \(\) => \{\s*if \(mountedRef.current\) router\.back\(\)/);
});

test('MomentDetailScreen only shows the delete action to the author', () => {
  const src = read(SRC);

  // Ownership is derived from the authed user vs. the post author.
  assert.match(src, /currentUserId\s*=\s*useAuthStore/);
  assert.match(src, /const isOwner\s*=[\s\S]*currentUserId === post\.author\.id/);

  // The trash action is passed to NavHeader gated on isOwner.
  assert.match(src, /rightActions=\{\s*\n?\s*isOwner/);
  assert.match(src, /icon:\s*'trash-outline'/);
  assert.match(src, /onPress:\s*handleDeleteMoment/);
});

test('MomentDetailScreen lets a comment author long-press to delete', () => {
  const src = read(SRC);

  // Long-press is gated to the comment's own author and routes to the handler.
  assert.match(
    src,
    /onLongPress=\{[\s\S]*item\.comment\.user\.id === currentUserId[\s\S]*handleDeleteComment\(item\.comment\.id\)/,
  );
  // The comment delete handler calls the API and prunes local + store state.
  assert.match(src, /await deleteMomentComment\(commentId\)/);
  assert.match(src, /storeRemoveComment\(id, commentId\)/);
});
