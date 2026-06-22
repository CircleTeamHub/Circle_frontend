const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const exists = (p) => fs.existsSync(path.join(process.cwd(), p));
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const scopes = ['discover', 'profile', 'contacts', 'messages'];

test('every tab scope has a user/[id]/moments route re-exporting the screen', () => {
  for (const scope of scopes) {
    const p = `app/(tabs)/${scope}/user/[id]/moments.tsx`;
    assert.ok(exists(p), `missing route file: ${p}`);
    assert.match(read(p), /UserMomentsScreen/);
  }
});
