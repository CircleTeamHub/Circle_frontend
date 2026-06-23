const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('MomentCard renders comment preview rows from moment comments', () => {
  const src = read('src/features/discover/components/moment-card.tsx');

  assert.match(src, /post\.comments/);
  assert.match(src, /comments\.map/);
  assert.match(src, /comment\.user\.nickname/);
  assert.match(src, /comment\.replyTo/);
  assert.match(src, /comment\.content/);
});
