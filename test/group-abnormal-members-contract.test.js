const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 群管理「异常成员」的前后端契约:
//   - FE fetchChatAbnormalMembers 打 GET /chat/conversations/:id/abnormal-members
//   - 「未登录时长」的天数档两边逐值一致(服务端 @IsIn 只认这几档,多一档就 400)
// 后端源码按 ../circle_be 读;本地或 CI 没有后端检出时跳过。
const root = process.cwd();
const backendRoot = process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const beRules = path.join(backendRoot, 'src/chat/chat-group-abnormal-members.ts');
const beController = path.join(backendRoot, 'src/chat/chat.controller.ts');

const read = (file) => fs.readFileSync(file, 'utf8');
const dayOptions = (source) => {
  const match = source.match(/ABNORMAL_INACTIVE_DAY_OPTIONS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'ABNORMAL_INACTIVE_DAY_OPTIONS not found');
  return match[1].split(',').map((value) => Number(value.trim()));
};

test('the client calls the abnormal-members endpoint with a day option', () => {
  const api = read(path.join(root, 'src/chat-core/api.ts'));
  assert.match(api, /\/chat\/conversations\/\$\{conversationId\}\/abnormal-members\?inactiveDays=\$\{inactiveDays\}/);
});

test('backend serves the route and accepts exactly the client day options', { skip: !fs.existsSync(beRules) }, () => {
  assert.match(read(beController), /@Get\('conversations\/:id\/abnormal-members'\)/);
  const client = dayOptions(read(path.join(root, 'src/chat-core/protocol.ts')));
  assert.deepEqual(dayOptions(read(beRules)), client);
});
