const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('moment detail keeps a persistent comment bar at the bottom (Douyin style)', () => {
  const src = read('src/features/discover/screens/MomentDetailScreen.tsx');

  assert.match(src, /commentBar:/);
  assert.match(src, /commentBarPill:/);
  assert.match(src, /discover\.commentInput\.barPlaceholder/);
  // 点触发栏 = 打开无回复对象的评论输入浮层。
  assert.match(
    src,
    /\{!commentTarget \? \(\s*<Pressable[\s\S]*?setCommentTarget\(\{ replyTo: null \}\)/,
  );
  // 浮层打开时隐藏触发栏，避免出现双输入条。
  assert.match(src, /\{!commentTarget \? \(/);
  assert.match(src, /happy-outline/);
  assert.match(src, /accessibilityRole="button"/);
});

test('comment bar placeholder ships in all five locales', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      json.discover?.commentInput?.barPlaceholder,
      `${locale} missing discover.commentInput.barPlaceholder`,
    );
  }
});
