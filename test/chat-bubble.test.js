const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat bubbles expose the aligned sizing and richer location-card structure', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/components/chat-bubble.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /maxWidth: 280/);
  assert.match(source, /datePillText/);
  assert.match(source, /sentStatusIcon/);
  assert.match(source, /locationImage/);
});
