const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// iOS 上 allowsEditing 会退回弹出很慢的 UIImagePickerController，相册入口一律走裁剪步骤。
for (const [shape, files] of [
  ['square', [
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
    'src/features/auth/screens/OnboardingProfileScreen.tsx',
    'src/hooks/use-change-avatar.ts',
    'src/features/discover/screens/CircleDetailScreen.tsx',
  ]],
  ['free', [
    'src/features/chat/screens/ChatBackgroundScreen.tsx',
    'src/features/discover/hooks/use-change-cover.ts',
    'src/features/discover/hooks/use-change-circle-cover.ts',
  ]],
]) {
  test(`${shape} library pickers go through the crop step before storing the asset`, () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      assert.match(source, new RegExp(`useImageCropStep\\('${shape}'\\)`), file);
      assert.match(source, new RegExp(`getCropLibraryPickerOptions\\('${shape}'\\)`), file);
      assert.match(source, /cropIfNeeded|cropCircleIcon/, file);
      assert.doesNotMatch(source.replace(/const cameraOptions[\s\S]*?\};/, ''), /allowsEditing:\s*true/, file);
    }
  });
}

test('the camera keeps its native square editor', () => {
  assert.match(
    fs.readFileSync('src/hooks/use-change-avatar.ts', 'utf8'),
    /const cameraOptions[\s\S]*?allowsEditing:\s*true[\s\S]*?aspect:\s*\[1,\s*1\]/,
  );
});

// 裁剪页是 hook 产出的节点：调用方漏渲染的话，选完图会一直等一个永远不出现的页面。
test('every screen that starts a crop renders the crop step', () => {
  for (const [file, nodes] of [
    ['src/features/profile/screens/EditProfileFieldScreen.tsx', ['avatarCropper']],
    ['src/features/auth/screens/OnboardingProfileScreen.tsx', ['avatarCropper']],
    ['src/features/chat/screens/ChatBackgroundScreen.tsx', ['backgroundCropper']],
    ['src/features/discover/screens/UserMomentsScreen.tsx', ['coverCropper']],
    ['src/features/discover/screens/CircleDetailScreen.tsx', ['circleAvatarCropper', 'circleIconCropper', 'circleCoverCropper']],
    ['src/features/chat/screens/ChatInfoScreen.tsx', ['groupAvatarCropper']],
    ['src/features/profile/screens/SettingsScreen.tsx', ['avatarCropper']],
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    for (const node of nodes) {
      assert.match(source, new RegExp(`(\\{${node}\\}|cropper=\\{${node}\\})`), `${file} does not render ${node}`);
    }
  }
});
