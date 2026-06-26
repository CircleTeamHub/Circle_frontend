const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/discover/components/plaza-post-card.tsx';

test('PlazaPostCard wires delete to the API and discover store', () => {
  const src = read(SRC);

  assert.match(src, /deletePlazaPost/);
  assert.match(src, /storeRemovePlazaPost\s*=\s*useDiscoverStore/);
  assert.match(src, /await deletePlazaPost\(post\.id\)/);
  assert.match(src, /storeRemovePlazaPost\(post\.id\)/);
});

test('PlazaPostCard only exposes delete to the post owner', () => {
  const src = read(SRC);

  // The trash affordance is rendered under an isOwnPost guard and routes to the handler.
  assert.match(src, /\{isOwnPost \? \(\s*\n\s*<Pressable[\s\S]*?onPress=\{handleDeletePost\}/);
  assert.match(src, /name="trash-outline"/);
});
