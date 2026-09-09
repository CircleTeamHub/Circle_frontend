const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 圈主在圈子信息页按不了「退出」——后端 leaveCircle 对 OWNER 直接 403
// (CIRCLE_OWNER_CANNOT_LEAVE)。以前这页照样给圈主渲染退出按钮,按下去
// 只能吃一个错误弹窗。这组测试钉住:圈主看到的是解散,而且解散打的是
// 圈子端点(DELETE /circle/:id),不是独立群聊那条会话端点。
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const BACKEND_ROOT = path.join(__dirname, '..', '..', 'circle_be');
const hasBackend = fs.existsSync(
  path.join(BACKEND_ROOT, 'src/circle/circle.controller.ts'),
);

test('circle owner sees dissolve instead of leave on the circle info screen', () => {
  const screen = read('src/features/chat/screens/ChatInfoScreen.tsx');

  // 圈主身份来自圈子成员角色(useGroupMemberViewAccess),不是会话 ownerId ——
  // 后者只对独立群聊有意义。groupID 为空(临时房/独立群)时不成立。
  assert.match(screen, /const isCircleOwner = Boolean\(groupID\) && isOwner;/);

  // 按钮三分叉:独立群主=解散会话,圈主=解散圈子,其余=退出。
  assert.match(screen, /\? handleDissolveGroup\s*\n\s*: isCircleOwner\s*\n\s*\? handleDissolveCircle\s*\n\s*: handleLeaveGroup/);
  assert.match(
    screen,
    /isStandaloneGroupOwner \|\| isCircleOwner\s*\n?\s*\? t\('chat\.dissolve'\)/,
  );

  // 不可逆操作必须二次确认,并且文案要说清后果。
  assert.match(
    screen,
    /Alert\.alert\(t\('chat\.dissolveCircle'\), t\('chat\.dissolveCircleWarning'\)/,
  );
  // 打的是圈子端点,传的是圈子 id(groupID),不是会话 id。
  assert.match(screen, /dissolveCircle\(groupID\)/);
  // 本机先摘掉圈子和会话,不等服务端的 removed 推送。
  assert.match(screen, /useCirclesStore\.getState\(\)\.removeCircle\(groupID\)/);
  assert.match(screen, /removeConversation\(dissolvedConversationID\)/);
});

test('dissolveCircle calls DELETE /circle/:id', () => {
  const api = read('src/services/api/circles.ts');
  assert.match(
    api,
    /export async function dissolveCircle\(id: string\): Promise<void> \{\s*\n\s*await apiClient<void>\(`\/circle\/\$\{id\}`, \{ method: 'DELETE' \}\);/,
  );
  // 退圈端点没有被顺手改掉:两条路径必须并存。
  assert.match(api, /`\/circle\/\$\{id\}\/leave`, \{ method: 'DELETE' \}/);
});

test('dissolve copy and the owner-only error code exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const bundle = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of ['dissolve', 'dissolveCircle', 'dissolveCircleWarning']) {
      assert.ok(bundle.chat[key], `${locale} chat.${key}`);
    }
    assert.ok(
      bundle.serverErrors.CIRCLE_OWNER_ONLY_DISSOLVE,
      `${locale} serverErrors.CIRCLE_OWNER_ONLY_DISSOLVE`,
    );
  }
  assert.match(
    read('src/services/api/server-error-codes.ts'),
    /'CIRCLE_OWNER_ONLY_DISSOLVE'/,
  );
});

test(
  'the backend exposes the owner-only dissolve route',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const controller = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/circle/circle.controller.ts'),
      'utf8',
    );
    // 两条 DELETE 必须都在:退圈给成员,解散给圈主。
    assert.match(controller, /@Delete\(':id\/leave'\)/);
    assert.match(controller, /@Delete\(':id'\)\s*\n\s*@HttpCode\(HttpStatus\.NO_CONTENT\)/);
    assert.match(controller, /dissolveCircle\(req\.user\.userId, id\)/);

    const service = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/circle/circle.service.ts'),
      'utf8',
    );
    // 解散只软删圈子,不碰 adminState —— 那是管理台停用的溯源字段。
    assert.match(service, /async dissolveCircle\(/);
    assert.match(service, /data: \{ deleted: true \},/);
    assert.doesNotMatch(
      service.slice(service.indexOf('async dissolveCircle(')),
      /adminState:/,
    );

    const codes = fs.readFileSync(
      path.join(BACKEND_ROOT, 'src/common/app-error-codes.ts'),
      'utf8',
    );
    assert.match(codes, /'CIRCLE_OWNER_ONLY_DISSOLVE'/);
  },
);
