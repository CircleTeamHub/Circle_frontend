const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('friend search matches by remark, not only nickname/accountId', () => {
  const screen = read('src/features/search/screens/SearchScreen.tsx');

  // haystack 必须包含备注（friend.remark），否则按备注搜不到人。
  assert.match(
    screen,
    /`\$\{friend\.remark \?\? ''\}\$\{friend\.nickname\}\$\{friend\.accountId\}`/,
  );
});

test('friend search result shows remark as primary name with nickname subtitle', () => {
  const screen = read('src/features/search/screens/SearchScreen.tsx');

  // 有备注时以备注为主名，副行显示真实昵称。
  assert.match(screen, /const remark = friend\.remark\?\.trim\(\)/);
  assert.match(screen, /const displayName = remark \|\| friend\.nickname/);
  assert.match(screen, /const subtitle = remark \? friend\.nickname : friend\.accountId/);
  // 跳资料页同样优先用备注名。
  assert.match(screen, /friend\.remark\?\.trim\(\) \|\| friend\.nickname/);
});


test('tapping a chat-record hit jumps to that message via searchedMsgID', () => {
  const screen = read('src/features/search/screens/SearchScreen.tsx');

  // 命中消息带上 clientMsgID，点击时作为 searchedMsgID 传给聊天页定位。
  assert.match(screen, /targetMsgID: match\.id/);
  assert.match(screen, /params\.searchedMsgID = targetMsgID/);
  assert.match(screen, /handlePressChat\(conversation, item\.targetMsgID\)/);
});
