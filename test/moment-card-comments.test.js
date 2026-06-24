const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('MomentCard renders comment preview rows from moment comments', () => {
  const src = read('src/features/discover/components/moment-card.tsx');

  assert.match(src, /post\.comments/);
  assert.match(src, /buildMomentCommentThreads/);
  assert.match(src, /getMomentCommentPreviewState/);
  assert.match(src, /visibleCommentThreads\.map/);
  assert.match(src, /thread\.comment\.user\.nickname/);
  assert.match(src, /thread\.comment\.replyTo/);
  assert.match(src, /thread\.comment\.content/);
  assert.match(src, /thread\.replies\.map/);
  assert.match(src, /moment\.showMoreComments/);
});
