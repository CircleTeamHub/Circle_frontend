const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('getUserMomentsHref maps every scope to user/[id]/moments', () => {
  const src = read('src/features/user/utils/routes.ts');
  assert.match(src, /export function getUserMomentsHref/);
  assert.match(src, /\/\(tabs\)\/contacts\/user\/\[id\]\/moments/);
  assert.match(src, /\/\(tabs\)\/profile\/user\/\[id\]\/moments/);
  assert.match(src, /\/\(tabs\)\/discover\/user\/\[id\]\/moments/);
  assert.match(src, /\/\(tabs\)\/messages\/user\/\[id\]\/moments/);
});
