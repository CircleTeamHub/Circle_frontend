const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat bubbles expose the aligned sizing and richer location-card structure', () => {
  const receivedPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/received-bubble.tsx',
  );
  const received = fs.readFileSync(receivedPath, 'utf8');

  const datePillPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/date-pill.tsx',
  );
  const datePill = fs.readFileSync(datePillPath, 'utf8');

  const sentPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/sent-bubble.tsx',
  );
  const sent = fs.readFileSync(sentPath, 'utf8');

  const locationPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/location-card.tsx',
  );
  const location = fs.readFileSync(locationPath, 'utf8');

  assert.match(received, /maxWidth: 280/);
  assert.match(datePill, /datePillText/);
  assert.match(sent, /sentStatusIcon/);
  assert.match(location, /locationImage/);
});

test('chat bubbles expose refined avatar and location-card body structure', () => {
  const receivedPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/received-bubble.tsx',
  );
  const received = fs.readFileSync(receivedPath, 'utf8');

  const locationPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/location-card.tsx',
  );
  const location = fs.readFileSync(locationPath, 'utf8');

  assert.match(received, /receivedAvatarSlot/);
  assert.match(location, /locationCardBody/);
  assert.match(location, /locationCardContent/);
});

test('chat card bubbles keep their width while reducing vertical height', () => {
  const sharedPath = path.join(
    process.cwd(),
    'src/features/chat/components/bubbles/shared.tsx',
  );
  const shared = fs.readFileSync(sharedPath, 'utf8');

  assert.match(shared, /const CHAT_CARD_STANDARD_WIDTH = 260;/);
  assert.match(shared, /const LOCATION_CARD_WIDTH = 248;/);
  assert.match(shared, /const CHAT_CARD_PADDING_VERTICAL = 10;/);

  const styleFiles = {
    sNote: 'src/features/chat/components/bubbles/note-card-bubble.tsx',
    sFriendCard: 'src/features/chat/components/bubbles/shared.tsx',
    sCircleCard: 'src/features/chat/components/bubbles/shared.tsx',
    sTransfer: 'src/features/chat/components/bubbles/transfer-card-bubble.tsx',
  };

  for (const [styleName, rel] of Object.entries(styleFiles)) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const start = source.indexOf(`const ${styleName} = StyleSheet.create`);
    assert.notEqual(start, -1, `${styleName} should exist`);
    const nextStyle = source.indexOf('const s', start + 1);
    const block = source.slice(start, nextStyle === -1 ? undefined : nextStyle);
    assert.match(block, /width:\s*CHAT_CARD_STANDARD_WIDTH/);
    assert.match(block, /maxWidth:\s*CHAT_CARD_STANDARD_WIDTH/);
    assert.match(block, /paddingVertical:\s*CHAT_CARD_PADDING_VERTICAL/);
  }

  const locationSource = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/chat/components/bubbles/location-card.tsx',
    ),
    'utf8',
  );
  const locationStart = locationSource.indexOf(
    'const sLocation = StyleSheet.create',
  );
  const locationNext = locationSource.indexOf('const s', locationStart + 1);
  const locationBlock = locationSource.slice(
    locationStart,
    locationNext === -1 ? undefined : locationNext,
  );
  assert.match(locationBlock, /width:\s*LOCATION_CARD_WIDTH/);
  assert.match(locationBlock, /maxWidth:\s*LOCATION_CARD_WIDTH/);
  assert.match(locationBlock, /paddingVertical:\s*CHAT_CARD_PADDING_VERTICAL/);
});
