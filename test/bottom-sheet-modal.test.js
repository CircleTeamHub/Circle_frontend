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
  assert.match(sharedSheet, /PanResponder\.create/);
  assert.match(sharedSheet, /onMoveShouldSetPanResponder/);
  assert.match(sharedSheet, /onPanResponderMove/);
  assert.match(sharedSheet, /onPanResponderRelease/);
  assert.match(sharedSheet, /DISMISS_MIN_DISTANCE/);
});

test("bottom sheet keeps children as direct sheet content for auto-height layout", () => {
  const sharedSheet = read("src/components/ui/bottom-sheet-modal.tsx");
  const createTempChatSheet = read("src/features/messages/components/CreateTempChatModal.tsx");

  assert.doesNotMatch(sharedSheet, /innerContent:\s*\{[\s\S]*flex:\s*1,?[\s\S]*\}/);
  assert.doesNotMatch(sharedSheet, /<Pressable\s+style=\{s\.innerContent\}/);
  assert.match(sharedSheet, /onStartShouldSetResponder=\{\(\) => true\}/);
  assert.match(createTempChatSheet, /gap:\s*Spacing\.lg/);
});

// 回归：分享给好友的面板里，下滑时列表和面板一起往下走，轻轻一带面板就关了。
test("sheet drag starts from the header, or from the body once its list is at the top", () => {
  const sharedSheet = read("src/components/ui/bottom-sheet-modal.tsx");

  // 把手区域照旧可拖；正文只有接入的列表滚到顶时才归面板。
  assert.match(sharedSheet, /const DISMISS_HANDLE_ZONE = 56;/);
  assert.match(
    sharedSheet,
    /scrollableCountRef\.current > 0 && scrollOffsetRef\.current <= SCROLL_TOP_TOLERANCE/,
  );
  assert.match(sharedSheet, /return startsInHandleZone \|\| listAtTop;/);
  // 捕获阶段抢在列表之前判定，拿到后不让出。
  assert.match(sharedSheet, /onMoveShouldSetPanResponderCapture: \(_event, gesture\) => shouldClaim\(gesture\)/);
  assert.match(sharedSheet, /onPanResponderTerminationRequest: \(\) => false/);
  // 面板根节点按下就是响应者，移动/松手必须按起点判断。
  assert.match(sharedSheet, /if \(!dragAllowedRef\.current\) return;/);
  // 列表顶部不回弹，否则 iOS 上回弹和面板位移叠在一起。
  assert.match(sharedSheet, /bounces=\{sheetScroll \? false : props\.bounces\}/);
  assert.match(sharedSheet, /overScrollMode=\{sheetScroll \? 'never' : props\.overScrollMode\}/);

  // 关闭要拖过面板三成（至少 120pt）；快甩还要同时拖出 48pt。
  assert.match(sharedSheet, /const DISMISS_MIN_DISTANCE = 120;/);
  assert.match(sharedSheet, /const DISMISS_HEIGHT_RATIO = 0\.3;/);
  assert.match(sharedSheet, /gesture\.vy > DISMISS_VELOCITY && dragged > DISMISS_FLING_MIN_DISTANCE/);
  assert.doesNotMatch(sharedSheet, /DISMISS_VELOCITY = 1\.1/);

  // 两个「分享给好友或群聊」面板的会话列表都要接入面板的滚动位置。
  for (const relativePath of [
    "src/features/notes/components/ShareNoteSheet.tsx",
    "src/features/qr/components/ShareQrSheet.tsx",
  ]) {
    const source = read(relativePath);
    assert.match(source, /<BottomSheetFlatList/, `${relativePath} 的列表要用 BottomSheetFlatList`);
    assert.doesNotMatch(source, /<FlatList/, `${relativePath} 不能再用裸 FlatList`);
  }
});

// 回归：下拉关闭时面板先跳回原位再消失（闪一下）。
test("dragging the sheet away does not snap it back while the modal fades out", () => {
  const sharedSheet = read("src/components/ui/bottom-sheet-modal.tsx");

  // 关闭动画结束直接交给 onClose，不先把位移清零。
  assert.match(sharedSheet, /\}\)\.start\(\(\) => \{\s*(\/\/[^\n]*\n\s*)*onCloseRef\.current\(\);/);
  // 复位只在重新打开时做。
  assert.match(sharedSheet, /if \(!visible\) return;\s*\n\s*dragY\.setValue\(0\);/);
});
