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

test('post signups screen supports searching and submitting up to three collaboration recognitions', () => {
  const source = readScreen();

  assert.match(source, /submitPostCollaborationRecognitions/);
  assert.match(source, /const \[searchQuery, setSearchQuery\]/);
  assert.match(source, /const \[selectedRecognitionIds, setSelectedRecognitionIds\]/);
  assert.match(source, /const filteredSignups =/);
  // 选择上限由「3 - 已认可数」推导，而非硬编码 3，避免重复认可超额。
  assert.match(source, /RECOGNITION_LIMIT = 3/);
  assert.match(source, /current\.size >= remainingSlots/);
  assert.match(source, /Array\.from\(selectedRecognitionIds\)/);
  assert.match(source, /collaboration-recognition-submit/);
});

test('post signups screen gates recognition on backend recognitionOpen and recognized flags', () => {
  const source = readScreen();

  // 面板仅在后端确认可认可时展示（活动已结束）。
  assert.match(source, /recognitionOpen && signups\.length > 0/);
  // 已认可状态来自后端 recognized 字段，刷新后不丢、无法重复提交。
  assert.match(source, /item\.recognized/);
  // 提交成功后重新拉取，让 recognized 成为已提交的唯一真相。
  assert.match(source, /void load\(\);/);
  // 不再用内存态 recognitionSubmitted 作为锁。
  assert.doesNotMatch(source, /recognitionSubmitted/);
});
