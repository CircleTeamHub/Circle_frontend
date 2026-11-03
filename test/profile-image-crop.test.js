const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('avatar and background pickers offer native editing before storing the selected asset', () => {
  const files = [
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
    'src/features/auth/screens/OnboardingProfileScreen.tsx',
    'src/hooks/use-change-avatar.ts',
    'src/features/chat/screens/ChatBackgroundScreen.tsx',
    'src/features/discover/hooks/use-change-cover.ts',
    'src/features/discover/hooks/use-change-circle-cover.ts',
  ];
  for (const file of files) {
    assert.match(fs.readFileSync(file, 'utf8'), /allowsEditing:\s*true/, file);
  }
  for (const file of files.slice(0, 3)) {
    assert.match(fs.readFileSync(file, 'utf8'), /aspect:\s*\[1,\s*1\]/, file);
  }
});
