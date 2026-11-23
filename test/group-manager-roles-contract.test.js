const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 群聊发言前的【群主】【管理员】标签,前后端契约:
//   - FE fetchChatGroupManagers 打 GET /chat/conversations/:id/managers
//   - 每行 { userId, role },role 两边都只有 'OWNER' | 'ADMIN'
// 后端源码按 ../circle_be 读;本地或 CI 没有后端检出时跳过。
const root = process.cwd();
const backendRoot = process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const beController = path.join(backendRoot, 'src/chat/chat.controller.ts');
const beTypes = path.join(backendRoot, 'src/chat/chat.types.ts');

const read = (file) => fs.readFileSync(file, 'utf8');
const managerDto = (source) => {
  const match = source.match(/export interface ChatGroupManagerDto \{([^}]+)\}/);
  assert.ok(match, 'ChatGroupManagerDto not found');
  return match[1].replace(/\s+/g, ' ').trim();
};

test('the client asks the managers endpoint for the sender tags', () => {
  const api = read(path.join(root, 'src/chat-core/api.ts'));
  assert.match(api, /\/chat\/conversations\/\$\{conversationId\}\/managers`/);
});

test('backend serves the route with the same row shape', { skip: !fs.existsSync(beController) }, () => {
  assert.match(read(beController), /@Get\('conversations\/:id\/managers'\)/);
  const client = managerDto(read(path.join(root, 'src/chat-core/protocol.ts')));
  assert.equal(managerDto(read(beTypes)), client);
});
