const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('fetchUserMoments hits /trace/feed with authorId and normalizes', () => {
  const src = read('src/services/api/moments.ts');
  assert.match(src, /export async function fetchUserMoments/);
  assert.match(src, /authorId:\s*userId/);
  assert.match(src, /\/trace\/feed/);
  assert.match(src, /items:\s*result\.items\.map\(normalizeMoment\)/);
});
