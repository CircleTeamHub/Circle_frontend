const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

// Bug: 打开着某人的聊天页时，对方再发消息，列表和 tab 仍显示未读，只有重新进入
// 页面才标记已读。根因：markConversationAsRead 只绑定在 ChatDetailScreen 挂载
// effect 上，入站消息监听器把消息 append 进活跃会话视图却从不标已读。
test("inbound messages for the open conversation are marked read in the listener", () => {
  const source = read("src/im/listeners.ts");

  // 新消息落到当前打开的会话时，监听器必须直接标记已读：清掉列表未读 badge、
  // 减少 tab 总未读，并给发送方回一条已读回执。
  assert.match(source, /markConversationMessageAsRead/);

  // 已读标记必须挂在「活跃会话」判断上，不能把任意会话都标记已读。
  assert.match(source, /activeConversation/);
});

test("listener marks read without importing client.ts (no require cycle)", () => {
  const source = read("src/im/listeners.ts");

  // client.ts 已 import listeners.ts；listeners.ts 反过来 import client.ts 会形成
  // 循环依赖。已读标记必须直接调 OpenIMSDK，而不是复用 client 的 wrapper。
  assert.doesNotMatch(source, /from ['"]@\/im\/client['"]/);
});
