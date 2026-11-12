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

test('post signups screen locks chat opens until it is focused again', () => {
  const source = readScreen();

  // 跳转后一直锁到回到本页(转场途中再点不会再压一层),失败时当场解锁。
  assert.match(source, /const chatLock = useNavigationLock\(\)/);
  assert.match(source, /if \(!chatLock\.tryLock\(\)\) return/);
  assert.match(source, /chatLock\.release\(\)/);
  // 以前在 finally 里立刻解锁,挡不住转场那几百毫秒。
  assert.doesNotMatch(source, /openingChatRef/);
});

const readRecognitionPicker = () =>
  fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/notifications/components/RecognitionPickerModal.tsx',
    ),
    'utf8',
  );

test('collaboration recognition is searched and picked in its own sheet, up to three people', () => {
  const source = readScreen();
  const picker = readRecognitionPicker();

  assert.match(source, /submitPostCollaborationRecognitions/);
  // 选择上限由「3 - 已认可数」推导，而非硬编码 3，避免重复认可超额。
  assert.match(source, /RECOGNITION_LIMIT = 3/);
  assert.match(source, /<RecognitionPickerModal/);
  assert.match(picker, /const \[query, setQuery\]/);
  assert.match(picker, /const visibleSignups =/);
  assert.match(picker, /selected\.size >= remainingSlots/);
  assert.match(picker, /Array\.from\(selected\)/);
  assert.match(picker, /collaboration-recognition-submit/);
});

test('the signer list is only a chat list; recognition sits behind its own button', () => {
  const source = readScreen();

  // Rows read like the messages list: the whole row opens the chat, recognition or not.
  assert.match(source, /onPress=\{\(\) => void openChat\(item\)\}/);
  assert.match(source, /chatBySigner/);
  assert.match(source, /collaboration-recognition-open/);
  assert.doesNotMatch(source, /toggleRecognitionSelection|selectedRecognitionIds|showRecognition/);
});

test('post signups screen opens signer profile from the avatar in the current stack', () => {
  const source = readScreen();

  assert.match(source, /getUserProfileHref/);
  assert.match(source, /const openSignerProfile = useCallback/);
  assert.match(source, /router\.navigate\(getUserProfileHref\(scope, signer\.userId, signer\.nickname\)\)/);
  assert.match(source, /onPress=\{\(\) => openSignerProfile\(item\)\}[\s\S]*?<Avatar/);
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

test('post signups screen renders compact display badges for each signer', () => {
  const source = readScreen();

  assert.match(source, /import \{ UserIconRow \} from ['"]@\/components\/ui\/user-icon-row['"]/);
  assert.match(source, /const displayIcons = item\.displayIcons \?\? \[\]/);
  assert.match(source, /displayIcons\.length > 0/);
  assert.match(source, /<UserIconRow[\s\S]*?icons=\{displayIcons\}[\s\S]*?compact[\s\S]*?compactSize="small"/);
});
