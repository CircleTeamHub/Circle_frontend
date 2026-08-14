const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
  'utf8',
);

const attachmentItems =
  source.match(/const ATTACHMENT_ITEMS:[\s\S]*?^\];/m)?.[0] ?? '';

test('chat attachment panel shows transfer on the first page and quick reply afterward', () => {
  const ids = [...attachmentItems.matchAll(/\{ id: '([^']+)'/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(ids.slice(0, 8), [
    'media',
    'camera',
    'voice-call',
    'location',
    'notes',
    'friend-card',
    'favorites',
    'transfer',
  ]);
  assert.equal(ids[8], 'quick-reply');
});
