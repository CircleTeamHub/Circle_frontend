const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("bottom sheets avoid native slide modal animation that lifts the dark backdrop", () => {
  const bottomSheetFiles = [
    "src/components/ui/option-picker-sheet.tsx",
    "src/features/profile/components/account-switcher-sheet.tsx",
    "src/features/profile/screens/EditProfileFieldScreen.tsx",
    "src/features/messages/components/CreateTempChatModal.tsx",
    "src/features/messages/components/ShareTempChatModal.tsx",
    "src/features/notes/components/NoteShareQrSheet.tsx",
  ];

  for (const relativePath of bottomSheetFiles) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /animationType=["']slide["']/,
      `${relativePath} should animate only the sheet content, not the whole Modal`,
    );
    assert.match(
      source,
      /BottomSheetModal/,
      `${relativePath} should use the shared BottomSheetModal wrapper`,
    );
  }

  const sharedSheet = read("src/components/ui/bottom-sheet-modal.tsx");
  assert.match(sharedSheet, /animationType=["']fade["']/);
  assert.match(sharedSheet, /Animated\.View/);
  assert.match(sharedSheet, /translateY/);
});

test("bottom sheet keeps children as direct sheet content for auto-height layout", () => {
  const sharedSheet = read("src/components/ui/bottom-sheet-modal.tsx");
  const createTempChatSheet = read("src/features/messages/components/CreateTempChatModal.tsx");

  assert.doesNotMatch(sharedSheet, /innerContent:\s*\{[\s\S]*flex:\s*1,?[\s\S]*\}/);
  assert.doesNotMatch(sharedSheet, /<Pressable\s+style=\{s\.innerContent\}/);
  assert.match(sharedSheet, /onStartShouldSetResponder=\{\(\) => true\}/);
  assert.match(createTempChatSheet, /gap:\s*Spacing\.lg/);
});
