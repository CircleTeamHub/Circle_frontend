const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const INPUT_SCROLL_FILES = [
  'src/features/auth/screens/LoginScreen.tsx',
  'src/features/auth/screens/RegisterScreen.tsx',
  'src/features/auth/screens/OnboardingProfileScreen.tsx',
  'src/components/app/login-security-code-gate.tsx',
  'src/features/profile/screens/ChangePasswordScreen.tsx',
  'src/features/profile/screens/ChangeSecurityCodeScreen.tsx',
  'src/features/profile/screens/EditProfileFieldScreen.tsx',
  'src/features/profile/screens/AppSettingsScreen.tsx',
  'src/features/user/screens/EditFriendRemarkScreen.tsx',
  'src/features/user/screens/EditFriendTagsScreen.tsx',
  'src/features/social/screens/SendFriendRequestScreen.tsx',
  'src/features/social/screens/AddFriendScreen.tsx',
  'src/features/social/screens/CreatePostScreen.tsx',
  'src/features/social/screens/SelectNoteScreen.tsx',
  'src/features/search/screens/SearchScreen.tsx',
  'src/features/notes/screens/NotesScreen.tsx',
  'src/features/notes/components/GroupManagerSheet.tsx',
  'src/features/chat/screens/ChatHistorySearchHubScreen.tsx',
  'src/features/chat/screens/ChatHistoryTextScreen.tsx',
  'src/features/chat/screens/EditGroupNoticeScreen.tsx',
  'src/features/chat/screens/ForwardPickerScreen.tsx',
  'src/features/chat/screens/SearchGroupMembersScreen.tsx',
  'src/features/chat/screens/ReportFriendScreen.tsx',
  'src/features/chat/screens/SharePickerScreen.tsx',
  'src/features/chat/screens/TransferComposerScreen.tsx',
  'src/features/messages/components/CreateTempChatModal.tsx',
  // 契约随自研栈迁移更新(意图不变):临时建群两屏已删(建群=建圈子)。
  'src/features/messages/screens/GroupManagementScreen.tsx',
  'src/features/discover/screens/CreateMomentScreen.tsx',
  'src/features/discover/screens/CreateCircleScreen.tsx',
  'src/features/discover/screens/EditCircleScreen.tsx',
  'src/features/discover/screens/DiscoverCirclesScreen.tsx',
  'src/features/discover/screens/InviteToCircleScreen.tsx',
  'src/features/discover/screens/MyCirclesScreen.tsx',
  'src/features/discover/screens/SelectCityScreen.tsx',
  'src/features/discover/screens/SelectFilterCirclesScreen.tsx',
];

test('input scroll containers share down-drag keyboard dismissal behavior', () => {
  const helper = read('src/components/ui/keyboard-dismiss.ts');

  assert.match(helper, /Keyboard\.dismiss\(\)/);
  assert.match(helper, /keyboardDismissMode:\s*'on-drag'/);
  assert.match(helper, /keyboardShouldPersistTaps:\s*'handled'/);

  for (const file of INPUT_SCROLL_FILES) {
    const source = read(file);
    assert.match(
      source,
      /<(ScrollView|FlatList|SectionList)[\s\S]{0,900}\{\.\.\.keyboardDismissOnDragProps\}|keyboardDismissMode="on-drag"|onScrollBeginDrag=\{closeInputPanels\}/,
      `${file} should dismiss keyboard when the user drags its scrollable input area`,
    );
  }
});

test('onboarding profile form dismisses the keyboard when dragged', () => {
  const source = read('src/features/auth/screens/OnboardingProfileScreen.tsx');

  assert.match(source, /keyboardDismissOnDragProps/);
  assert.match(source, /<ScrollView[\s\S]*\{\.\.\.keyboardDismissOnDragProps\}/);
});

test('keyboard dismiss helper calls Keyboard.dismiss at drag start', () => {
  const filePath = path.join(process.cwd(), 'src/components/ui/keyboard-dismiss.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  let dismissCount = 0;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'react-native') {
        return {
          Keyboard: {
            dismiss: () => {
              dismissCount += 1;
            },
          },
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  context.module.exports.dismissKeyboardOnScrollBeginDrag();

  assert.equal(dismissCount, 1);
  assert.equal(
    context.module.exports.keyboardDismissOnDragProps.onScrollBeginDrag,
    context.module.exports.dismissKeyboardOnScrollBeginDrag,
  );
});
