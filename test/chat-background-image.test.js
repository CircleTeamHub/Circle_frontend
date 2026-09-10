const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 背景偏好只活在 MMKV 里（按设备、按会话），服务端从不读它。此前这里把图片 PUT 到
// `chat/` 前缀再存直链，而 circle_be 的 buildPublicReadBucketPolicy 白名单里没有 chat
// —— 匿名 GET 一律 403，图加载不出来，只剩上面那层蒙版，整块消息区变成一片灰。
test('chat background never uploads to the private chat/ prefix', () => {
  const src = read('src/features/chat/screens/ChatBackgroundScreen.tsx');

  assert.doesNotMatch(src, /folder:\s*'chat'/);
  assert.doesNotMatch(src, /requestUploadPresign/);
  assert.doesNotMatch(src, /uploadLocalFileToPresignedUrl/);
  assert.doesNotMatch(src, /presign\.fileUrl/);
  assert.match(src, /persistChatBackgroundImage/);
});

test('chat background images are copied into a persistent local directory', () => {
  const src = read('src/features/chat/utils/chat-background-image.ts');

  // 图必须落在 Documents：Paths.cache 会被「清除缓存」和系统低存储时清掉，
  // picker 给的临时 uri 同理。
  assert.match(src, /Paths\.document/);
  assert.doesNotMatch(src, /Paths\.cache\s*,\s*BACKGROUND/);
  assert.match(src, /export async function persistChatBackgroundImage/);
  assert.match(src, /export function pruneChatBackgroundImages/);
});

test('chat background image util keeps the web build working without a filesystem', () => {
  const src = read('src/features/chat/utils/chat-background-image.ts');

  // expo-file-system 在 web 上只有空桩（FileSystemFile 是个空类），所以 web 必须
  // 走 data: URL，不能碰 File / Directory。
  assert.match(src, /Platform\.OS === 'web'/);
  assert.match(src, /CHAT_BACKGROUND_DATA_URL_PREFIX/);

  const uriSrc = read('src/features/chat/utils/chat-background-uri.ts');
  assert.match(uriSrc, /data:image\/jpeg;base64,/);
});

test('legacy remote background URIs are dropped on rehydrate instead of painting grey', () => {
  const src = read('src/features/chat/store/use-chat-preferences-store.ts');

  // 已经存过 http(s) 直链的用户不会自己想到「重新选一次图」——迁移必须自愈。
  assert.match(src, /version:\s*1/);
  assert.match(src, /migrate/);
  assert.match(src, /isLocalChatBackgroundImageUri/);
});

test('the preferences store does not drag native modules into its import graph', () => {
  const src = read('src/features/chat/store/use-chat-preferences-store.ts');

  // 这个 store 会被登出 teardown 和聊天页加载。纯判断走无依赖模块，
  // 带 expo-file-system / expo-image-manipulator 的那半只在登出时懒加载。
  assert.match(src, /from '@\/features\/chat\/utils\/chat-background-uri'/);
  assert.doesNotMatch(
    src,
    /^import[\s\S]*?from '@\/features\/chat\/utils\/chat-background-image'/m,
  );
  assert.match(src, /import\('@\/features\/chat\/utils\/chat-background-image'\)/);
});

test('the pure uri module stays free of native imports', () => {
  const src = read('src/features/chat/utils/chat-background-uri.ts');

  assert.doesNotMatch(src, /^import /m);
  assert.match(src, /export function isLocalChatBackgroundImageUri/);
});

test('the stored preference holds a file name, never an absolute container path', () => {
  const uriSrc = read('src/features/chat/utils/chat-background-uri.ts');
  const imageSrc = read('src/features/chat/utils/chat-background-image.ts');
  const chatSrc = read('src/features/chat/screens/ChatDetailScreen.tsx');

  // iOS 的 Data 容器 UUID 重装/更新后会变，存绝对路径 = 下次重装壁纸静默消失。
  assert.match(uriSrc, /CHAT_BACKGROUND_FILE_SCHEME = 'chat-bg:'/);
  // 裸 file:// 必须被判为无效，否则绝对路径还是能进偏好。
  assert.doesNotMatch(uriSrc, /startsWith\('file:\/\/'\)/);
  assert.match(imageSrc, /return `\$\{CHAT_BACKGROUND_FILE_SCHEME\}\$\{name\}`/);
  assert.match(imageSrc, /export function resolveChatBackgroundImageSource/);
  // 渲染侧必须先过 resolver 才交给 ImageBackground。
  assert.match(chatSrc, /resolveChatBackgroundImageSource\(style\.imageUri\)/);
});
