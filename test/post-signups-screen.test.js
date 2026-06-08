const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readScreen = () =>
  fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/notifications/screens/PostSignupsScreen.tsx',
    ),
    'utf8',
  );

test('post signups screen surfaces load failures instead of rendering them as empty data', () => {
  const source = readScreen();

  assert.doesNotMatch(source, /fetchMyPostSignups\(postId\)\.catch\(\(\) => \[\]\)/);
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /setLoadError\(null\)/);
  assert.match(source, /setLoadError\(/);
  assert.match(source, /onPress=\{load\}/);
  assert.match(source, /notifications\.signupMgmt\.loadFailed/);
});

test('post signups screen only marks signups read after a successful list fetch', () => {
  const source = readScreen();

  const fetchIndex = source.indexOf('await fetchMyPostSignups(postId)');
  const markReadIndex = source.indexOf('await markMyPostSignupsRead(postId)');

  assert.notEqual(fetchIndex, -1);
  assert.notEqual(markReadIndex, -1);
  assert.ok(markReadIndex > fetchIndex);
  assert.doesNotMatch(source, /void markMyPostSignupsRead\(postId\)/);
});

test('post signups screen uses a ref guard to prevent duplicate chat opens', () => {
  const source = readScreen();

  assert.match(source, /const openingChatRef = useRef\(false\)/);
  assert.match(source, /if \(openingChatRef\.current\) return/);
  assert.match(source, /openingChatRef\.current = true/);
  assert.match(source, /openingChatRef\.current = false/);
});
