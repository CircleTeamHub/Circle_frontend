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


test('global search loads the conversation snapshot it needs to group hits', () => {
  const screen = read('src/features/search/screens/SearchScreen.tsx');

  // 这个屏幕从联系人 tab 也能直接进,而会话快照只在消息页 focus 时拉。
  // 不自己补一次的话,冷启动搜聊天记录时 conversationById 是空的,
  // 服务端返回的每一条正文命中都会被 `if (!conversation) continue` 丢掉,
  // 界面上表现为「什么都搜不到」。
  assert.match(screen, /loadChatConversations/);

  // 判据必须是「拉过全量没有」,不能是 `conversations.length > 0`:
  // 从联系人/资料页点「发消息」会先走 ensureDirectConversation,它只 upsert
  // 那一个会话 —— 数组非空但内容残缺,按长度判就跳过了拉取,于是除那一个
  // 会话之外的所有命中照样被丢掉,还是「无结果」。
  // (这条断言原来锁的正是那个有 bug 的写法。)
  assert.match(screen, /if \(snapshotLoaded\) return;\s*\n\s*loadChatConversations\(\)/);
  assert.match(screen, /\}, \[snapshotLoaded\]\);/);
  assert.doesNotMatch(screen, /if \(rawConversations\.length > 0\) return;/);
});

test('tapping a chat-record hit jumps to that message via searchedMsgID', () => {
  const screen = read('src/features/search/screens/SearchScreen.tsx');

  // 命中消息带上 clientMsgID，点击时作为 searchedMsgID 传给聊天页定位。
  assert.match(screen, /targetMsgID: match\.id/);
  assert.match(screen, /params\.searchedMsgID = targetMsgID/);
  assert.match(screen, /handlePressChat\(conversation, item\.targetMsgID\)/);
});
