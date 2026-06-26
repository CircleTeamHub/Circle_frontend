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

test('chat bubbles expose refined avatar and location-card body structure', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/components/chat-bubble.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /receivedAvatarSlot/);
  assert.match(source, /locationCardBody/);
  assert.match(source, /locationCardContent/);
});

test('chat card bubbles keep their width while reducing vertical height', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/components/chat-bubble.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const CHAT_CARD_STANDARD_WIDTH = 260;/);
  assert.match(source, /const LOCATION_CARD_WIDTH = 248;/);
  assert.match(source, /const CHAT_CARD_PADDING_VERTICAL = 10;/);

  for (const styleName of [
    'sNote',
    'sFriendCard',
    'sCircleCard',
    'sTransfer',
  ]) {
    const start = source.indexOf(`const ${styleName} = StyleSheet.create`);
    assert.notEqual(start, -1, `${styleName} should exist`);
    const nextStyle = source.indexOf('const s', start + 1);
    const block = source.slice(start, nextStyle === -1 ? undefined : nextStyle);
    assert.match(block, /width:\s*CHAT_CARD_STANDARD_WIDTH/);
    assert.match(block, /maxWidth:\s*CHAT_CARD_STANDARD_WIDTH/);
    assert.match(block, /paddingVertical:\s*CHAT_CARD_PADDING_VERTICAL/);
  }

  const locationStart = source.indexOf('const sLocation = StyleSheet.create');
  const locationNext = source.indexOf('const s', locationStart + 1);
  const locationBlock = source.slice(locationStart, locationNext);
  assert.match(locationBlock, /width:\s*LOCATION_CARD_WIDTH/);
  assert.match(locationBlock, /maxWidth:\s*LOCATION_CARD_WIDTH/);
  assert.match(locationBlock, /paddingVertical:\s*CHAT_CARD_PADDING_VERTICAL/);
});
