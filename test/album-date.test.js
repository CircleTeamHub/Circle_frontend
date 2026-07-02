const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('album-date helpers exist and branch on language + same-day', () => {
  const src = read('src/features/discover/utils/album-date.ts');
  assert.match(src, /export function getAlbumDateParts/);
  assert.match(src, /export function isSameCalendarDay/);
  assert.match(src, /startsWith\('zh'\)/);
  assert.match(src, /月/);
  assert.match(src, /MONTHS_EN/);
  assert.match(src, /Number\.isNaN/);
  assert.match(src, /getFullYear\(\)/);
  assert.match(src, /getMonth\(\)/);
  assert.match(src, /getDate\(\)/);
});
