const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const DETAIL = 'src/features/discover/screens/CircleDetailScreen.tsx';
const MINE = 'src/features/discover/screens/MyCirclesScreen.tsx';

test('CircleDetailScreen: invite button shares the primary style of 进入群聊', () => {
  const src = read(DETAIL);
  // invite routes to the invite screen using the chat (primary) button style
  assert.match(src, /circle\/\[id\]\/invite[\s\S]*?d\.chatBtnText/);
  // the old purple invite style is gone
  assert.doesNotMatch(src, /inviteBtn/);
});

test('CircleDetailScreen: copy-circle-info button is removed', () => {
  const src = read(DETAIL);
  assert.doesNotMatch(src, /handleCopyCircleInfo/);
  assert.doesNotMatch(src, /复制圈子信息/);
});

test('CircleDetailScreen: non-members get a join button', () => {
  const src = read(DETAIL);
  assert.match(src, /handleJoinCircle/);
  assert.match(src, /await joinCircle\(id\)/);
  assert.match(src, /const isActiveMember = circle\?\.myStatus === 'ACTIVE'/);
  assert.match(src, /\{!isActiveMember \? \(/);
});

test('MyCirclesScreen: open a circle by a pasted id', () => {
  const src = read(MINE);
  assert.match(src, /handleOpenById/);
  assert.match(src, /joinId\.trim\(\)/);
  assert.match(
    src,
    /router\.push\(`\/\(tabs\)\/discover\/circle\/\$\{encodeURIComponent\(id\)\}`\)/,
  );
});
