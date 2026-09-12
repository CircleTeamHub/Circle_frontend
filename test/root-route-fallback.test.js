const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('bare or unmatched deep links fall back into the authenticated app flow', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/+not-found.tsx'),
    'utf8',
  );

  assert.match(source, /import \{ Redirect \} from 'expo-router'/);
  assert.match(source, /<Redirect href="\/" \/>/);
});
