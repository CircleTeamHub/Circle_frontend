const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle card: type, send, and decode are wired through the IM layer', () => {
  const types = read('src/types/index.ts');
  assert.match(types, /interface CircleCardData/);
  assert.match(types, /'circle-card'/);
  assert.match(types, /circleCard\?: CircleCardData/);

  const client = read('src/im/client.ts');
  assert.match(client, /sendCircleCardMessage/);
  assert.match(client, /createCardMessage/);
  assert.match(client, /kind: 'circle'/);

  // mappers disambiguate circle vs friend card via ex.kind
  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /ext\.kind === 'circle'/);
  assert.match(mappers, /type: 'circle-card'/);
  assert.match(mappers, /circleId: card\.userID/);
});

test('circle card: bubble renders and taps through to the circle detail', () => {
  const bubble = read('src/features/chat/components/chat-bubble.tsx');
  assert.match(bubble, /export const CircleCardBubble/);
  assert.match(bubble, /message\.circleCard/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(chat, /case 'circle-card':/);
  assert.match(chat, /<CircleCardBubble/);
  // tapping opens the circle detail (where the join button lives)
  assert.match(chat, /params: \{ id: card\.circleId \}/);
});

test('ShareCircleCardScreen sends the card to a chosen conversation', () => {
  const share = read(
    'src/features/discover/screens/ShareCircleCardScreen.tsx',
  );
  assert.match(share, /sendCircleCardMessage/);
  assert.match(share, /targetConversationID: conversation\.id/);
});
