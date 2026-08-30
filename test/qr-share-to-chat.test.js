const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];
const readLocale = (lng) => JSON.parse(read(`src/i18n/locales/${lng}.json`));

/** qr-payload 运行时零依赖,可以直接在 vm 里跑真实实现。 */
function loadQrPayload() {
  const filePath = path.join(root, 'src/features/qr/qr-payload.ts');
  const transpiled = ts.transpileModule(read('src/features/qr/qr-payload.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const ctx = { module: { exports: {} }, exports: {} };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(transpiled, ctx);
  return ctx.module.exports;
}

/** 取出 `export const NAME = [...]` 里的字符串字面量;文档注释里的同名词不会误伤。 */
function arrayLiteral(source, name) {
  const start = source.indexOf(`${name} = [`);
  if (start < 0) return [];
  const end = source.indexOf(']', start);
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** 从 `function NAME(` 起到下一个顶层 `\n}` 为止的函数体。 */
function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到 ${name}`);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end);
}

// ─── 入口:二维码页只提供「分享二维码到聊天」，不再把令牌链接甩进系统面板 ──────

test('QrCodeScreen 的第二个按钮是分享二维码，不是系统分享链接', () => {
  const screen = read('src/features/qr/screens/QrCodeScreen.tsx');

  assert.match(screen, /qr\.shareQr/);
  assert.match(screen, /<ShareQrSheet/);

  // 链接分享等于把入群 / 加好友令牌明文交给任意 App —— 这条路整条拆掉,
  // 不是改文案。留任何一处 Share.share 都算回退。
  assert.doesNotMatch(screen, /from 'react-native'[\s\S]{0,200}\bShare,/);
  assert.doesNotMatch(screen, /Share\.share/);
  assert.doesNotMatch(screen, /qr\.shareLink/);
});

test('分享卡片带的是令牌本身，不是拼好的整条 URL', () => {
  const screen = read('src/features/qr/screens/QrCodeScreen.tsx');

  // 令牌原文单独存一份:qrValue 是给屏幕上那个码用的深链,卡片只要令牌。
  assert.match(screen, /setQrToken\(result\.token\)/);
  assert.match(screen, /token: qrToken/);
  // 换 type / target 时先清空,免得短暂拿到上一个码的令牌发出去。
  assert.match(screen, /setQrToken\(null\)/);
  // 令牌没下来之前按钮是禁用态。
  assert.match(screen, /disabled=\{!qrToken \|\| rotating\}/);
});

// ─── 发送链路:卡片消息，不再上传图片 ─────────────────────────────────────────

test('ShareQrSheet 把二维码当 qr-card 卡片发进所选会话', () => {
  const sheet = read('src/features/qr/components/ShareQrSheet.tsx');

  assert.match(sheet, /loadChatConversations/);
  assert.match(sheet, /sendCardMessage/);
  assert.match(sheet, /type: 'qr-card'/);
  assert.match(sheet, /BottomSheetModal/);
  assert.match(sheet, /qr\.shareToChat\.title/);

  // 发图那条链路整条撤掉:不再截 PNG、不再 presign、不再占 chat/ 存储配额。
  assert.doesNotMatch(sheet, /sendImageMessage|requestUploadPresign|qrBase64/);
});

test('会话选择器支持就地搜索，且空态与搜不到分开', () => {
  const sheet = read('src/features/qr/components/ShareQrSheet.tsx');

  assert.match(sheet, /const \[query, setQuery\] = useState\(''\)/);
  assert.match(sheet, /item\.name\.toLowerCase\(\)\.includes\(trimmedQuery\)/);
  assert.match(sheet, /data=\{visibleConversations\}/);
  assert.match(sheet, /if \(!visible\) setQuery\(''\)/);
  assert.match(sheet, /qr\.shareToChat\.noMatch/);
  assert.match(sheet, /qr\.shareToChat\.empty/);
  assert.match(sheet, /keyboardShouldPersistTaps="handled"/);
});

test('并发发送被 inFlightRef 挡住，失败文案不泄露底层 error.message', () => {
  const sheet = read('src/features/qr/components/ShareQrSheet.tsx');

  assert.match(sheet, /if \(inFlightRef\.current\) return;/);
  assert.match(sheet, /qr\.shareToChat\.failedMessage/);
  assert.doesNotMatch(sheet, /error instanceof Error\s*\?\s*error\.message/);
});

// ─── 收方:卡片长什么样、点了去哪 ─────────────────────────────────────────────

test('二维码卡片把「是谁的码、扫了会怎样」写在卡面上', () => {
  const bubble = read('src/features/chat/components/bubbles/qr-card-bubble.tsx');

  // 三种码各有自己的副标题与行动号召 —— 这正是「只发一张黑白方块」缺的信息。
  for (const key of [
    'qr.card.userType',
    'qr.card.groupType',
    'qr.card.circleType',
    'qr.card.userFooter',
    'qr.card.groupFooter',
    'qr.card.circleFooter',
  ]) {
    assert.ok(bubble.includes(key), `气泡缺 ${key}`);
  }
  // 头像按类型分流:群用群头像、圈子用圈子头像、名片用用户头像。
  assert.match(bubble, /GroupChatAvatar/);
  assert.match(bubble, /CircleAvatar/);
  // 码是本端按令牌就地画的,不依赖任何上传上去的图。
  assert.match(
    bubble,
    /buildQrUrl\(card\.token, OUTBOUND_APP_QR_SCHEME\)/,
  );
  // 二维码永远黑白:暗色主题下跟着换底色就直接扫不出来了。
  assert.match(bubble, /const QR_DARK = '#111111'/);
  assert.match(bubble, /const QR_LIGHT = '#FFFFFF'/);
  // 令牌被净化成空串的卡片不渲染,而不是画一个扫不通的码。
  assert.match(bubble, /if \(!card \|\| !card\.token\) return null;/);
});

test('点卡片走扫码同一条落地页，路径写死在本端', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /<QrCardBubble/);
  assert.match(
    screen,
    /router\.push\(\{ pathname: '\/qr', params: \{ t: card\.token \} \}\)/,
  );
});

// ─── 安全:卡片载荷完全由对端构造 ─────────────────────────────────────────────

test('normalizeQrToken 只放行本站令牌，外站链接一律丢弃', () => {
  const { normalizeQrToken, buildQrUrl } = loadQrPayload();
  const token = 'A'.repeat(32);

  // 裸令牌与本站深链都认。
  assert.equal(normalizeQrToken(token), token);
  assert.equal(normalizeQrToken(buildQrUrl(token)), token);
  assert.equal(normalizeQrToken(`  ${token}  `), token);
  assert.equal(normalizeQrToken(`https://windnote.ai/qr?t=${token}`), token);

  // 外站链接、伪造 scheme、垃圾串一律 null —— 对端因此没法决定「点这张卡开什么」。
  for (const hostile of [
    'https://evil.example/qr?t=' + token,
    'javascript:alert(1)',
    'windnoteai://chat?t=' + token,
    'not a token',
    '',
    '   ',
    'x',
  ]) {
    assert.equal(normalizeQrToken(hostile), null, `不该放行: ${hostile}`);
  }
});

test('mapper 把不合法令牌净化成空串，而不是原样透传', () => {
  const mappers = read('src/chat-core/message-mappers.ts');
  const body = sliceFunction(mappers, 'sanitizeQrCard');

  assert.match(body, /normalizeQrToken\(textField\(content, 'token', 512\)\) \?\? ''/);
  // 头像同样过媒体白名单,和别的卡片一个待遇。
  assert.match(body, /mediaField\(content, 'avatarUrl'\)/);
  // qrType 是枚举,对端塞别的一律回落,不能直接进 Record 索引。
  assert.match(body, /QR_CARD_TYPES\.includes/);
});

// ─── 跨仓契约:后端得放这条消息类型过去 ───────────────────────────────────────

test('后端把 qr-card 列进客户端可发类型，并给了预览标签', () => {
  const bePath = process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
  if (!fs.existsSync(bePath)) return; // CI 里没检出后端仓就跳过

  const constants = fs.readFileSync(
    path.join(bePath, 'src/chat/chat.constants.ts'),
    'utf8',
  );
  const service = fs.readFileSync(
    path.join(bePath, 'src/chat/chat.service.ts'),
    'utf8',
  );

  // 不在 CLIENT_MESSAGE_TYPES 里 = 发送直接 400,整条功能是死的。
  // 按数组字面量取,不用跨文件正则 —— 文档注释里也会出现这两个名字。
  assert.ok(
    arrayLiteral(constants, 'CLIENT_MESSAGE_TYPES').includes('qr-card'),
    'qr-card 不在 CLIENT_MESSAGE_TYPES 里',
  );
  // 分享类卡片,绝不能混进服务端专属清单。
  assert.ok(
    !arrayLiteral(constants, 'SERVER_MESSAGE_TYPES').includes('qr-card'),
    'qr-card 不该出现在 SERVER_MESSAGE_TYPES 里',
  );
  assert.match(service, /'qr-card': '\[二维码\]'/);
});

// ─── i18n:五种语言齐全 ───────────────────────────────────────────────────────

test('分享 sheet / 卡片 / 列表预览的文案五种语言都齐，旧的 shareLink 已下线', () => {
  const shareToChatKeys = [
    'title',
    'searchPlaceholder',
    'friendHint',
    'groupHint',
    'sending',
    'confirmTitle',
    'confirmMessage',
    'sentTitle',
    'sentMessage',
    'failedTitle',
    'failedMessage',
    'loadFailed',
    'empty',
    'noMatch',
  ];
  const cardKeys = [
    'userType',
    'groupType',
    'circleType',
    'userFooter',
    'groupFooter',
    'circleFooter',
  ];
  const scanKeys = [
    'scanFromAlbum',
    'scanAlbumNoCodeTitle',
    'scanAlbumNoCodeMessage',
    'scanAlbumFailedTitle',
    'scanAlbumFailedMessage',
  ];

  for (const lng of LOCALES) {
    const json = readLocale(lng);
    assert.equal(typeof json.qr.shareQr, 'string', `${lng} qr.shareQr`);
    assert.equal(json.qr.shareLink, undefined, `${lng} 仍留着废弃的 qr.shareLink`);
    assert.equal(typeof json.im.preview.qr, 'string', `${lng} im.preview.qr`);

    for (const key of shareToChatKeys) {
      assert.equal(
        typeof json.qr.shareToChat[key],
        'string',
        `${lng} qr.shareToChat.${key}`,
      );
    }
    for (const key of cardKeys) {
      assert.equal(typeof json.qr.card[key], 'string', `${lng} qr.card.${key}`);
    }
    for (const key of scanKeys) {
      assert.equal(typeof json.messages[key], 'string', `${lng} messages.${key}`);
    }
  }
});

test('带插值的文案在五种语言里都保留占位符', () => {
  for (const lng of LOCALES) {
    const json = readLocale(lng);
    const confirm = json.qr.shareToChat.confirmMessage;
    assert.ok(confirm.includes('{{subject}}'), `${lng} confirmMessage 缺 {{subject}}`);
    assert.ok(confirm.includes('{{name}}'), `${lng} confirmMessage 缺 {{name}}`);
    assert.ok(json.im.preview.qr.includes('{{name}}'), `${lng} preview.qr 缺 {{name}}`);
  }
});

// ─── 闭环:发出去的码得能被认出来 ─────────────────────────────────────────────

test('扫码页保留相册识别入口 —— 对面转发出去的码截图也要能认', () => {
  const screen = read('src/features/messages/screens/ScanScreen.tsx');

  assert.match(screen, /scanFromURLAsync/);
  assert.match(screen, /launchImageLibraryAsync/);
  assert.match(screen, /messages\.scanFromAlbum/);
  assert.match(screen, /requestMediaLibraryPermissionsAsync/);
  assert.match(screen, /permissions\.photoLibrary/);
  assert.match(screen, /messages\.scanAlbumNoCodeMessage/);
  assert.match(screen, /messages\.scanAlbumFailedMessage/);
  assert.match(screen, /handleBarcodeScanned\(found\)/);
});

test('相册扫码不依赖摄像头授权，进入扫码页也不会自动索取摄像头权限', () => {
  const screen = read('src/features/messages/screens/ScanScreen.tsx');

  assert.doesNotMatch(screen, /useEffect\(/);
  const permissionGate = screen.indexOf('if (!permission?.granted)');
  assert.ok(permissionGate >= 0, '摄像头未授权态应统一保留相册入口');
  const deniedPane = screen.slice(permissionGate, screen.indexOf('<CameraView'));
  assert.match(deniedPane, /handleScanFromAlbum/);
  assert.match(deniedPane, /messages\.scanFromAlbum/);
  assert.match(deniedPane, /onPress=\{canAskAgain \? requestPermission : Linking\.openSettings\}/);
});
