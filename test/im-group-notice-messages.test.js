const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('group notification messages render as centered system notices in chat', () => {
  const mappers = read('src/im/mappers.ts');

  assert.match(mappers, /function getGroupNoticeText/);
  // 聊天流：群通知（群已创建/新成员加入等）渲染为灰条，而不是整条被过滤——
  // 否则新圈子群里只有这类消息时聊天页是一片空白。
  assert.match(
    mappers,
    /const groupNoticeText = getGroupNoticeText\(item\.contentType\)/,
  );
  assert.match(mappers, /type: 'system-notice',\s*text: groupNoticeText/);
  // 会话列表预览与聊天流共用同一套文案。
  assert.match(
    mappers,
    /return getGroupNoticeText\(message\.contentType\) \?\? '';/,
  );
  // MemberEnter（扫码/搜索进群）也算“新成员加入”。
  assert.match(
    mappers,
    /case MessageType\.MemberInvited:\s*case MessageType\.MemberEnter:/,
  );
});
