const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// Avatar recycling and late failures are covered by avatar.spec.tsx behavior tests.

test('moments feed locks failed pagination until explicit refresh', () => {
  const store = read('src/features/discover/store/use-moments-store.ts');
  const feed = read('src/features/discover/components/moments-feed.tsx');

  assert.match(store, /fetchError: boolean/);
  assert.match(store, /if \(!reset && state\.fetchError\) return/);
  assert.match(store, /fetchError: false/);
  assert.match(feed, /!fetchError/);
  assert.match(feed, /fetchMoments\(false\)\.catch/);
  assert.match(feed, /await fetchMoments\(true\);[\s\S]*?catch/);
});
