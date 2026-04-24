const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('icons api uses the backend icon endpoints', () => {
  const src = read('src/services/api/icons.ts');

  assert.match(src, /\/icon\/options/);
  assert.match(src, /\/icon\/display/);
  assert.match(src, /fetchIconOptions/);
  assert.match(src, /updateDisplayIcons/);
});
