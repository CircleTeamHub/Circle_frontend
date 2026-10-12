const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

test('profile keeps relationship feedback except the redundant accepted label', () => {
  const screen = read('src/features/user/screens/UserProfileScreen.tsx');
  // Pending / blocked / failed lookups hide the add button, so the chip must
  // still explain why; only ACCEPTED is dropped.
  for (const key of ['unavailable', 'notAdded', 'requestSent', 'requestReceived', 'blocked']) {
    assert.match(screen, new RegExp(`'userProfile\\.relationshipStatus\\.${key}'`), key);
  }
  assert.doesNotMatch(screen, /'userProfile\.relationshipStatus\.accepted'/);
  assert.match(screen, /friendStatusLoadError\s*\n\s*\? 'userProfile\.relationshipStatus\.unavailable'/);
  // Only "not added" gets the warning treatment, and its foreground uses the
  // contrast-safe token rather than the raw orange.
  assert.match(screen, /const friendStatusIsWarning =\s*\n\s*friendStatusLabelKey === 'userProfile\.relationshipStatus\.notAdded'/);
  assert.match(screen, /friendStatusTextWarning: \{\s*\n\s*color: colors\.warningText/);
  assert.match(screen, /color=\{colors\.warningText\}/);
  assert.doesNotMatch(screen, /color: colors\.warning,/);
});
