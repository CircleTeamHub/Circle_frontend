const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function listSources(dir) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const relPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSources(relPath));
    } else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) {
      files.push(relPath);
    }
  }
  return files;
}

const CONTAINER = 'src/components/ui/keyboard-avoiding-container.tsx';

// Android 开了 edge-to-edge（android/gradle.properties edgeToEdgeEnabled=true，Expo SDK 54+
// 强制）之后，windowSoftInputMode=adjustResize 不再缩窗口。RN 的 KeyboardAvoidingView 在
// Android 上 behavior=undefined 就只是个普通 View：键盘整个盖住聊天输入栏、表单底部按钮
// （Android 16 模拟器实测，聊天输入栏被压到键盘下面）。统一收口到一个容器，两端都走 padding。
test('the shared keyboard container pads above the keyboard on both platforms', () => {
  const src = read(CONTAINER);

  assert.match(src, /KeyboardAvoidingView/);
  assert.match(src, /behavior = 'padding'/);
  assert.doesNotMatch(src, /Platform\.OS/);
});

test('no file drives React Native KeyboardAvoidingView directly', () => {
  const offenders = [...listSources('src'), ...listSources('app')]
    .filter((file) => file !== CONTAINER)
    .filter((file) => {
      const src = read(file);
      return (
        /<KeyboardAvoidingView\b/.test(src) ||
        /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*'react-native'/.test(src)
      );
    });

  assert.deepEqual(offenders, []);
});

// 这些页面的输入框或提交按钮贴在屏幕下半部（输入栏、footer、marginTop:auto 的按钮），
// 窗口不缩时会被键盘盖住，必须包在容器里。
const SCREENS_WITH_LOW_INPUTS_OR_ACTIONS = [
  'src/components/app/app-dialog-host.tsx',
  'src/components/app/login-security-code-gate.tsx',
  'src/features/auth/screens/LoginScreen.tsx',
  'src/features/auth/screens/RegisterScreen.tsx',
  'src/features/auth/screens/ForgotPasswordScreen.tsx',
  'src/features/auth/screens/OnboardingProfileScreen.tsx',
  'src/features/profile/screens/ChangePasswordScreen.tsx',
  'src/features/profile/screens/ChangeSecurityCodeScreen.tsx',
  'src/features/profile/screens/EditProfileFieldScreen.tsx',
  'src/features/profile/screens/FancyNumberScreen.tsx',
  'src/features/user/screens/EditFriendRemarkScreen.tsx',
  'src/features/user/screens/EditFriendTagsScreen.tsx',
  'src/features/social/screens/CreatePostScreen.tsx',
  'src/features/social/screens/SendFriendRequestScreen.tsx',
  'src/features/contacts/screens/FriendActivityDetailScreen.tsx',
  'src/features/contacts/screens/FriendTagsScreen.tsx',
  'src/features/chat/screens/ChatDetailScreen.tsx',
  'src/features/chat/screens/ChatInfoScreen.tsx',
  'src/features/chat/screens/EditGroupNoticeScreen.tsx',
  'src/features/chat/screens/ReportFriendScreen.tsx',
  'src/features/chat/screens/TransferComposerScreen.tsx',
  'src/features/chat/screens/NewGroupScreen.tsx',
  'src/features/chat/screens/InviteGroupMembersScreen.tsx',
  'src/features/chat/screens/SharePickerScreen.tsx',
  'src/features/messages/screens/GroupManagementScreen.tsx',
  'src/features/discover/components/moment-comment-input.tsx',
  'src/features/discover/screens/CreateMomentScreen.tsx',
  'src/features/discover/screens/CreateCircleScreen.tsx',
  'src/features/discover/screens/EditCircleScreen.tsx',
  'src/features/discover/screens/InviteToCircleScreen.tsx',
  'src/features/discover/screens/SelectCityScreen.tsx',
  'src/features/discover/screens/SelectFilterCirclesScreen.tsx',
  'src/features/notes/components/GroupManagerSheet.tsx',
  'src/features/notes/screens/EditNoteScreen.tsx',
  'src/features/notes/screens/NotesScreen.tsx',
];

test('screens with low inputs or footer actions lift them above the keyboard', () => {
  for (const file of SCREENS_WITH_LOW_INPUTS_OR_ACTIONS) {
    assert.match(
      read(file),
      /<KeyboardAvoidingContainer\b/,
      `${file} should wrap its layout in KeyboardAvoidingContainer`,
    );
  }
});

// 底部面板统一在 BottomSheetModal 里避让，里面的 sheet 不要再自己套一层：
// 嵌套时内层按父容器坐标算遮挡，会重复加 padding。
test('bottom sheets avoid the keyboard once, inside BottomSheetModal', () => {
  assert.match(read('src/components/ui/bottom-sheet-modal.tsx'), /<KeyboardAvoidingContainer\b/);

  for (const file of [
    'src/features/notes/components/NoteRemarkSheet.tsx',
    'src/features/notes/components/NoteGroupPickerSheet.tsx',
  ]) {
    assert.doesNotMatch(read(file), /<KeyboardAvoidingContainer\b/, `${file} nests a second container`);
  }

  const groupManager = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.equal(
    (groupManager.match(/<KeyboardAvoidingContainer\b/g) ?? []).length,
    1,
    'GroupManagerSheet should only wrap its full-page modal, not the nested bottom sheet',
  );
});

// Modal / 底部面板是新的 Dialog 窗口：输入框挂载时窗口还没拿到焦点，Android 上原生 autoFocus
// 只抢到光标、键盘弹不出来，JS 侧又记成已聚焦，之后 focus() 也被跳过（模拟器 0/2 → 延后聚焦 3/3）。
const MODAL_HOSTED_AUTO_FOCUS_INPUTS = [
  'src/components/app/app-dialog-card.tsx',
  'src/features/chat/screens/ChatInfoScreen.tsx',
  'src/features/contacts/screens/FriendTagsScreen.tsx',
  'src/features/discover/components/moment-comment-input.tsx',
  'src/features/notes/components/GroupManagerSheet.tsx',
  'src/features/notes/components/NoteRemarkSheet.tsx',
  'src/features/notes/components/NoteGroupPickerSheet.tsx',
  'src/features/messages/screens/GroupManagementScreen.tsx',
];

test('inputs that open with a modal focus only after the Android dialog window is up', () => {
  const hook = read('src/hooks/use-modal-input-auto-focus.ts');
  assert.match(hook, /MODAL_INPUT_NATIVE_AUTO_FOCUS = Platform\.OS !== 'android'/);
  assert.match(hook, /setTimeout\(\(\) => ref\.current\?\.focus\(\)/);

  for (const file of MODAL_HOSTED_AUTO_FOCUS_INPUTS) {
    const src = read(file);
    assert.doesNotMatch(src, /^\s*autoFocus\s*$/m, `${file} still uses bare autoFocus inside a modal`);
    assert.match(src, /autoFocus=\{MODAL_INPUT_NATIVE_AUTO_FOCUS\}/, `${file} should gate native autoFocus`);
    assert.match(src, /useModalInputAutoFocus\(/, `${file} should focus after the modal window is shown`);
  }
});

test('security gate keeps permanent safe-area spacing outside keyboard padding', () => {
  const src = read('src/components/app/login-security-code-gate.tsx');

  assert.match(src, /container:\s*\{[^}]*paddingTop:\s*insets\.top/);
  assert.match(src, /content:\s*\{[^}]*paddingBottom:\s*insets\.bottom \+ Spacing\.xl/);
  assert.match(src, /contentContainerStyle=\{\[s\.content, d\.content\]\}/);
  assert.doesNotMatch(
    src,
    /container:\s*\{[^}]*paddingBottom:\s*insets\.bottom \+ Spacing\.xl/,
    'permanent bottom spacing must not be passed to KeyboardAvoidingContainer',
  );
});
