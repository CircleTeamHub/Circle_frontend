const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('every group-management stack has the same expansion screen for native back and gestures', () => {
  for (const scope of ['messages', 'contacts', 'discover', 'explore', 'profile']) {
    assert.match(
      read(`app/(tabs)/${scope}/group-expansion.tsx`),
      /export \{ default \} from '@\/features\/profile\/screens\/GroupExpansionScreen'/,
    );
  }
});

test('expansion uses navigation history instead of replacing the group-management route', () => {
  const source = read('src/features/profile/screens/GroupExpansionScreen.tsx');
  assert.doesNotMatch(source, /router\.replace|returnScope|onBackPress=/);
});
