const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const DETAIL = 'src/features/discover/screens/CircleDetailScreen.tsx';
const MINE = 'src/features/discover/screens/MyCirclesScreen.tsx';

test('CircleDetailScreen: the invite button is purple', () => {
  const src = read(DETAIL);
  assert.match(src, /inviteBtn: \{ backgroundColor: colors\.purple \}/);
  assert.match(src, /circle\/\[id\]\/invite[\s\S]*?d\.inviteBtnText/);
});

test('CircleDetailScreen: copy circle info to the clipboard', () => {
  const src = read(DETAIL);
  assert.match(src, /handleCopyCircleInfo/);
  assert.match(src, /expo-clipboard/);
  assert.match(src, /setStringAsync/);
  assert.match(src, /圈子ID：/);
});

test('CircleDetailScreen: non-members get a join button', () => {
  const src = read(DETAIL);
  assert.match(src, /handleJoinCircle/);
  assert.match(src, /await joinCircle\(id\)/);
  assert.match(src, /circle\.myStatus !== 'ACTIVE' \?/);
});

test('MyCirclesScreen: open a circle by a pasted id', () => {
  const src = read(MINE);
  assert.match(src, /handleOpenById/);
  assert.match(src, /joinId\.trim\(\)/);
  assert.match(src, /pathname: '\/\(tabs\)\/discover\/circle\/\[id\]'/);
});
