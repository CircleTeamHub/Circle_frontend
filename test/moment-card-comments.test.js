const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('MomentCard renders comment preview rows from moment comments', () => {
  const src = read('src/features/discover/components/moment-card.tsx');

  assert.match(src, /post\.comments/);
  assert.match(src, /buildMomentCommentThreads/);
  assert.match(src, /getMomentCommentPreviewState/);
  assert.match(src, /visibleCommentThreads\.map/);
  assert.match(src, /thread\.comment\.user\.nickname/);
  assert.match(src, /thread\.comment\.replyTo/);
  assert.match(src, /thread\.comment\.content/);
  assert.match(src, /thread\.replies\.map/);
  assert.match(src, /moment\.showMoreComments/);
});

test('MomentCard looks up reply targets by parent-comment author, not the comment id', () => {
  const src = read('src/features/discover/components/moment-card.tsx');

  // replyTo.id 是父**评论** id(后端 replyToID 引用另一条评论),不是用户 id。直接当 userId
  // 会拿评论 UUID 去查 /user/vip-levels——永远查不到、回复名字永不亮、每条多一次废请求。
  // 修法:用 comments 建 commentId→user.id 映射,把 replyTo.id 解析成父评论作者的用户 id。
  assert.match(src, /replyTargetUserIdByCommentId/);
  assert.match(src, /new Map\(comments\.map\(\(c\) => \[c\.id, c\.user\.id\]\)\)/);
  assert.match(
    src,
    /replyTargetUserIdByCommentId\.get\(\s*thread\.comment\.replyTo\.id,?\s*\)/,
  );
  assert.match(
    src,
    /replyTargetUserIdByCommentId\.get\(\s*reply\.replyTo\.id,?\s*\)/,
  );
  // 绝不再把评论 id 当 userId 传给 MemberName。
  assert.doesNotMatch(src, /userId=\{thread\.comment\.replyTo\.id\}/);
  assert.doesNotMatch(src, /userId=\{reply\.replyTo\.id\}/);
});
