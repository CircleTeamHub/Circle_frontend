const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat history api fetches conversation message pages', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/chat-history.ts'),
    'utf8',
  );

  assert.match(source, /fetchRestorableConversationMessages/);
  assert.match(
    source,
    /\/chat-history\/conversations\/\$\{encodeURIComponent\(conversationID\)\}\/messages/,
  );
  assert.match(source, /beforeSeq/);
  assert.match(source, /toOpenIMMessageItem/);
});
