const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 聊天记录各页(关键词/日期/文件/媒体/搜索入口)点结果回到聊天页。原来都没传
// 会话类型,getChatDetailHref 默认 'private':群聊的搜索结果被当成单聊打开 ——
// 没有发送者名字、没有 @,已读回执拿群 id 当对端去查。
const root = process.cwd();
const screensDir = path.join(root, 'src/features/chat/screens');

test('every chat history screen opens the chat with the conversation type', () => {
  const screens = fs
    .readdirSync(screensDir)
    .filter((name) => /^ChatHistory.*Screen\.tsx$/.test(name));
  assert.ok(screens.length >= 6, 'history screens moved?');
  let calls = 0;
  for (const name of screens) {
    const source = fs.readFileSync(path.join(screensDir, name), 'utf8');
    for (const match of source.matchAll(/getChatDetailHref\(([^;]*?)\)/g)) {
      calls += 1;
      // 会话类型是第七个参数;第六个是要定位的消息 id。少写一个 undefined,类型就被当成
      // 消息 id 传进去(两者都是字符串,tsc 不报)—— 这里按位置钉死。
      assert.match(
        match[1],
        /^'messages', sourceID, title, undefined, conversationID, (?:clientMsgID|undefined), conversationType$/,
        `${name}: ${match[0]} does not pass the conversation type in the right position`,
      );
    }
    if (/getChatDetailHref\(/.test(source)) {
      assert.match(
        source,
        /const conversationType = useChatHistoryConversationType\(conversationID\);/,
        `${name} does not resolve the conversation type`,
      );
    }
  }
  assert.ok(calls >= 9, `expected every navigation back to chat, saw ${calls}`);
});

test('groups and temporary groups open as group chats', () => {
  const hook = fs.readFileSync(
    path.join(root, 'src/features/chat/hooks/use-chat-history-conversation-type.ts'),
    'utf8',
  );
  assert.match(hook, /type === 'GROUP' \|\| type === 'TEMP' \? 'group' : 'private'/);
  assert.match(hook, /state\.conversations\.find\(\(conversation\) => conversation\.id === conversationID\)\?\.type/);
});
