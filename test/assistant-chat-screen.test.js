const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('the assistant wizard loads my circles even when opened from a circle', () => {
  const src = read('src/features/assistant/screens/AssistantChatScreen.tsx');
  const startWizard =
    src.match(/const startWizard = useCallback\([\s\S]*?\n  \);\n/)?.[0] ?? '';

  // 带圈子入口的文案允许「选择其他圈子」，选项必须包含用户自己的全部圈子。
  assert.match(startWizard, /askCircleWithContext/);
  assert.match(startWizard, /\n      void fetchMyCircles\(\);/);
  assert.doesNotMatch(startWizard, /if \(!data\.contextCircle\)/);
});
