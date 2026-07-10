const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('moment card exposes inline comment/reply callbacks with detail fallback', () => {
  const card = read('src/features/discover/components/moment-card.tsx');

  assert.match(card, /onComment\?: \(postId: string\) => void/);
  assert.match(card, /onReplyComment\?: \(/);
  // 评论按钮：优先就地评论，未提供回调时退回跳详情。
  assert.match(card, /\(onComment \?\? onPress\)\(post\.id\)/);
  // 主评论行与回复行都把被点评论的 id+nickname 交给 onReplyComment。
  assert.match(
    card,
    /onReplyComment\(post\.id, \{\s*id: thread\.comment\.id,\s*nickname: thread\.comment\.user\.nickname,\s*\}\)/,
  );
  assert.match(
    card,
    /onReplyComment\(post\.id, \{\s*id: reply\.id,\s*nickname: reply\.user\.nickname,\s*\}\)/,
  );
  // 「展开更多评论」仍然进详情页看全部。
  assert.match(
    card,
    /s\.showMoreComments\}\s*onPress=\{\(\) => onPress\(post\.id\)\}/,
  );
});

test('comment composer supports image, mention, and emoji (Douyin parity)', () => {
  const input = read(
    'src/features/discover/components/moment-comment-input.tsx',
  );

  // 三件套按钮
  assert.match(input, /name="image-outline"/);
  assert.match(input, /name="at"/);
  assert.match(input, /name="happy-outline"/);
  // 图片：单选 → presign 上传 → onSubmit 带 images
  assert.match(input, /launchImageLibraryAsync/);
  assert.match(input, /requestUploadPresign/);
  assert.match(input, /uploadLocalFileToPresignedUrl/);
  assert.match(
    input,
    /onSubmit\(trimmed, replyTo\?\.id, images, mentionedUserIds\)/,
  );
  // 表情复用聊天页的 EmojiPicker；@ 用好友列表插入 @昵称
  assert.match(input, /EmojiPicker/);
  assert.match(input, /fetchFriends/);
  assert.match(input, /@\$\{friend\.nickname\} /);
  // 纯图评论可发送（文字或图片其一即可）
  assert.match(input, /text\.trim\(\)\.length > 0 \|\| imageUri !== null/);
});

test('comment images render in detail rows and tag the feed preview', () => {
  const detail = read('src/features/discover/screens/MomentDetailScreen.tsx');
  const card = read('src/features/discover/components/moment-card.tsx');
  const api = read('src/services/api/moments.ts');
  const types = read('src/types/index.ts');

  assert.match(detail, /item\.comment\.images\?\.length/);
  assert.match(detail, /commentImage/);
  assert.match(card, /moment\.imageTag/);
  assert.match(api, /images\?: string\[\]/);
  assert.match(types, /interface MomentComment \{[\s\S]*?images\?: string\[\]/);
});

test('comment composer overlays at window level so nested hosts stay visible', () => {
  const input = read(
    'src/features/discover/components/moment-comment-input.tsx',
  );

  // KeyboardAvoidingView 的 padding 按相对父容器坐标计算；宿主非全屏时输入条
  // 会藏进键盘底下。必须用透明 Modal 挂到窗口层。
  assert.match(input, /<Modal\s/);
  assert.match(input, /transparent/);
  assert.match(input, /onRequestClose=\{onDismiss\}/);
  assert.match(input, /<KeyboardAvoidingView/);
});

test('moments feed hosts the inline comment composer (no detail hop)', () => {
  const feed = read('src/features/discover/components/moments-feed.tsx');

  assert.match(feed, /MomentCommentInput/);
  assert.match(feed, /const \[commentTarget, setCommentTarget\] = useState/);
  assert.match(feed, /onComment=\{handleComment\}/);
  assert.match(feed, /onReplyComment=\{handleReplyComment\}/);
  // 提交 = 详情页同款链路：API → store 同步（feed 预览即时更新）。
  assert.match(feed, /addMomentComment\(target\.momentId, \{/);
  assert.match(feed, /storeAddComment\(target\.momentId, comment\)/);
  // 失败保留输入并弹错误（rethrow 让输入框不关闭）。
  assert.match(feed, /Alert\.alert\(\s*t\('moment\.commentFailedTitle'/);
  assert.match(feed, /throw error;/);
});
