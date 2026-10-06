const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('shared avatar images reset and fall back after a failed remote load', () => {
  for (const rel of [
    'src/components/ui/avatar.tsx',
    'src/components/ui/circle-avatar.tsx',
    'src/components/ui/group-chat-avatar.tsx',
  ]) {
    const source = read(rel);
    assert.match(source, /useState\(false\)/, rel);
    assert.match(source, /useEffect\(/, rel);
    assert.match(source, /onError=\{\(\) => setImageFailed\(true\)\}/, rel);
    assert.match(source, /!imageFailed/, rel);
  }
});

test('moments feed locks failed pagination until explicit refresh', () => {
  const store = read('src/features/discover/store/use-moments-store.ts');
  const feed = read('src/features/discover/components/moments-feed.tsx');

  assert.match(store, /fetchError: boolean/);
  assert.match(store, /if \(!reset && state\.fetchError\) return/);
  assert.match(store, /fetchError: true/);
  assert.match(store, /fetchError: false/);
  assert.match(feed, /!fetchError/);
  assert.match(feed, /fetchMoments\(false\)\.catch/);
  assert.match(feed, /await fetchMoments\(true\);[\s\S]*?catch/);
});
