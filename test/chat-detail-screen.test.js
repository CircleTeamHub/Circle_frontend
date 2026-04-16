const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat detail screen uses the aligned header and composer structure', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /headerMeta/);
  assert.match(source, /headerStatusText/);
  assert.match(source, /messageListContent/);
  assert.match(source, /composerShell/);
  assert.match(source, /composerInput/);
});

test('chat detail screen exposes refined message insets and composer action hierarchy', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /messageListInset/);
  assert.match(source, /composerActionBtn/);
  assert.match(source, /contentContainerStyle=\{\[s\.messageList, s\.messageListContent, s\.messageListInset\]\}/);
});

test('chat detail screen supports preview mode without an IM conversation', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const isPreviewMode = !conversationID/);
  assert.match(source, /当前仅预览聊天界面/);
  assert.match(source, /editable=\{!isPreviewMode\}/);
  assert.match(source, /disabled=\{sending \|\| isPreviewMode\}/);
});

test('chat detail screen reads the local chat background preference for the active conversation', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useChatPreferencesStore/);
  assert.match(source, /resolveChatBackgroundStyle/);
  assert.match(source, /ImageBackground/);
  assert.match(source, /backgroundPreference/);
  assert.match(source, /backgroundStyle/);
});
