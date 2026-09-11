const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadTsModule } = require('./helpers/load-ts-module');
const { createFakeIndexedDb } = require('./helpers/fake-indexed-db');

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
  const cacheDirPattern =
    /new Directory\(\s*Paths\.cache\s*,\s*CHAT_BACKGROUND_DIR_NAME\s*\)/;
  // 守卫自己得先能抓到它要防的写法：上一版写的是 /Paths\.cache\s*,\s*BACKGROUND/，
  // 而常量叫 CHAT_BACKGROUND_DIR_NAME —— 那个正则永远匹配不到，回退到 cache
  // 目录也照样绿。
  assert.match(
    'new Directory(Paths.cache, CHAT_BACKGROUND_DIR_NAME)',
    cacheDirPattern,
  );
  assert.doesNotMatch(src, cacheDirPattern);
  // 常量被改名也要挡住：任何以 Paths.cache 为根的目录都不行。
  assert.doesNotMatch(src, /new Directory\(\s*Paths\.cache/);

  assert.match(src, /Paths\.document/);
  assert.match(src, /export async function persistChatBackgroundImage/);
  assert.match(src, /export async function pruneChatBackgroundImages/);
});

test('the manipulator output is moved, not copied, so nothing lingers in the cache', () => {
  const src = read('src/features/chat/utils/chat-background-image.ts');

  // copy 而不删源 = 每换一次背景在 cache 里多压一份同样大小的 JPEG。
  assert.match(src, /produced\.move\(target\)/);
  // move 不可用的平台退回 copy，但必须紧跟着删源。
  const fallback = src.slice(src.indexOf('produced.copy(target)'));
  assert.match(fallback.slice(0, 200), /produced\.delete\(\)/);
});

test('the web platform file keeps image bytes out of the persisted store', () => {
  const web = read('src/features/chat/utils/chat-background-image.web.ts');

  // 1440px 的 JPEG 变成 data: URL 塞进 persist 的 zustand state，会吃光
  // localStorage 的 ~5MB 配额 —— 之后整份聊天偏好静默写不进去。
  assert.doesNotMatch(web, /data:image\//);
  assert.doesNotMatch(web, /base64/);
  assert.match(web, /indexedDB/);
  // web 上 expo-file-system 只有空桩，碰 File / Directory 只会静默失败。
  assert.doesNotMatch(web, /expo-file-system/);
  // 存进偏好的仍旧是 `chat-bg:<name>`，与原生端同一套语义。
  assert.match(web, /\$\{CHAT_BACKGROUND_FILE_SCHEME\}\$\{name\}/);

  const uriSrc = read('src/features/chat/utils/chat-background-uri.ts');
  assert.doesNotMatch(uriSrc, /data:image\//);
});

test('both platform files expose the same module surface', () => {
  // Metro 按平台择档：两边导出面一旦漂移，另一个平台在 import 处直接失败。
  const exportsOf = (rel) =>
    [...read(rel).matchAll(/export (?:async )?function (\w+)/g)]
      .map((match) => match[1])
      .sort();

  assert.deepEqual(exportsOf('src/features/chat/utils/chat-background-image.web.ts'), [
    'persistChatBackgroundImage',
    'pruneChatBackgroundImages',
    'resolveChatBackgroundImageSource',
  ]);
  assert.deepEqual(
    exportsOf('src/features/chat/utils/chat-background-image.ts'),
    exportsOf('src/features/chat/utils/chat-background-image.web.ts'),
  );
});

test('legacy remote background URIs are dropped on rehydrate instead of painting grey', () => {
  const src = read('src/features/chat/store/use-chat-preferences-store.ts');

  // 已经存过 http(s) 直链的用户不会自己想到「重新选一次图」——迁移必须自愈。
  // 行为断言见 test/chat-preferences-store.test.js。
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
  assert.match(
    src,
    /import\(\s*'@\/features\/chat\/utils\/chat-background-image'\s*\)/,
  );
});

test('the pure uri module stays free of native imports and is not re-exported', () => {
  const src = read('src/features/chat/utils/chat-background-uri.ts');

  assert.doesNotMatch(src, /^import /m);
  assert.match(src, /export function isLocalChatBackgroundImageUri/);

  // 从带 expo-file-system 的模块里转出这个纯判断，只会诱导调用方把原生依赖
  // 拖进纯代码路径（偏好 store 正是这样的调用方）。
  const image = read('src/features/chat/utils/chat-background-image.ts');
  assert.doesNotMatch(image, /export \{[^}]*isLocalChatBackgroundImageUri/);
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
  assert.match(imageSrc, /export async function resolveChatBackgroundImageSource/);
  // 渲染侧必须先过 resolver 才交给 ImageBackground。
  assert.match(chatSrc, /useChatBackgroundImageSource\(backgroundStyle\.imageUri\)/);
  assert.match(chatSrc, /source=\{\{ uri: backgroundImageUri \}\}/);
});

// ---- 行为：只下采样，绝不上采样 ----

function loadNormalizeModule() {
  const actionLog = [];
  const module = loadTsModule('src/features/chat/utils/chat-background-normalize.ts', {
    requireShim: (specifier) => {
      if (specifier === 'expo-image-manipulator') {
        return {
          SaveFormat: { JPEG: 'jpeg' },
          manipulateAsync: async (uri, actions, options) => {
            actionLog.push({ uri, actions, options });
            return { uri: `${uri}#normalized`, width: 0, height: 0 };
          },
        };
      }
      return require(specifier);
    },
  });
  return { ...module, actionLog };
}

test('a photo narrower than the cap is never resized', async () => {
  const { normalizeChatBackgroundImage, actionLog } = loadNormalizeModule();

  await normalizeChatBackgroundImage('file:///tmp/small.png', 800);

  // 给 manipulator 一个 width 就是等比缩放到那个宽度：对 800px 的图等于放大。
  assert.deepEqual([...actionLog[0].actions], []);
  assert.equal(actionLog[0].options.format, 'jpeg');
});

test('an unknown or zero source width skips the resize instead of upscaling to the cap', async () => {
  for (const width of [undefined, 0]) {
    const { normalizeChatBackgroundImage, actionLog } = loadNormalizeModule();

    await normalizeChatBackgroundImage('file:///tmp/unknown.jpg', width);

    // picker 拿不到尺寸时给的是 0。无条件 resize 1440 会把一张 300px 的图
    // 放大成 1440px 的糊图，且与「只下采样」的注释直接矛盾。
    assert.deepEqual(
      [...actionLog[0].actions],
      [],
      `width=${String(width)} 不该触发 resize`,
    );
  }
});

test('a photo wider than the cap is downsampled to the cap', async () => {
  const { normalizeChatBackgroundImage, actionLog } = loadNormalizeModule();

  await normalizeChatBackgroundImage('file:///tmp/huge.jpg', 4032);

  assert.deepEqual(JSON.parse(JSON.stringify(actionLog[0].actions)), [
    { resize: { width: 1440 } },
  ]);
});

// ---- 行为：web 档把图放进 IndexedDB，偏好里只留名字 ----

function loadWebModule({ withIndexedDb = true } = {}) {
  const fake = createFakeIndexedDb();
  // 纯判断模块零依赖，直接加载真身 —— 桩出来的谓词语义会和线上漂移。
  const uriModule = loadTsModule('src/features/chat/utils/chat-background-uri.ts');
  const module = loadTsModule('src/features/chat/utils/chat-background-image.web.ts', {
    requireShim: (specifier) => {
      if (specifier.endsWith('/chat-background-uri')) return uriModule;
      if (specifier.endsWith('/chat-background-normalize')) {
        return {
          normalizeChatBackgroundImage: async (sourceUri) => {
            const blob = new Blob([`bytes-of:${sourceUri}`], { type: 'image/jpeg' });
            return { uri: URL.createObjectURL(blob), width: 100, height: 100 };
          },
        };
      }
      return require(specifier);
    },
    context: withIndexedDb ? fake.globals : fake.globalsWithoutIndexedDb,
  });
  return { ...module, fake };
}

test('web stores the jpeg blob in IndexedDB and keeps only chat-bg:<name> in the preference', async () => {
  const { persistChatBackgroundImage, resolveChatBackgroundImageSource, fake } =
    loadWebModule();

  const stored = await persistChatBackgroundImage('blob:picked-photo', 800);

  assert.match(stored, /^chat-bg:bg-[0-9a-z.-]+\.jpg$/);
  // 偏好里绝不能出现图片字节——那正是 localStorage 配额被吃光的原因。
  assert.ok(stored.length < 80, `偏好值过长: ${stored}`);

  const names = [...fake.entries.keys()];
  assert.equal(names.length, 1);
  assert.equal(`chat-bg:${names[0]}`, stored);
  assert.ok(fake.entries.get(names[0]) instanceof Blob);

  const url = await resolveChatBackgroundImageSource(stored);
  assert.match(String(url), /^blob:/);
  // 同一个名字复用同一个 object URL，不会每次渲染都新建一个。
  assert.equal(await resolveChatBackgroundImageSource(stored), url);
});

test('web resolves nothing for legacy remote URIs and for blobs that are gone', async () => {
  const { persistChatBackgroundImage, resolveChatBackgroundImageSource, fake } =
    loadWebModule();

  assert.equal(
    await resolveChatBackgroundImageSource('https://cdn.example.com/bg.jpg'),
    null,
  );
  assert.equal(await resolveChatBackgroundImageSource(null), null);

  const stored = await persistChatBackgroundImage('blob:picked-photo', 800);
  fake.entries.clear();
  assert.equal(await resolveChatBackgroundImageSource(stored), null);
});

test('web prunes unreferenced blobs the way the native prune walks the directory', async () => {
  const {
    persistChatBackgroundImage,
    pruneChatBackgroundImages,
    resolveChatBackgroundImageSource,
    fake,
  } = loadWebModule();

  const first = await persistChatBackgroundImage('blob:first', 800);
  const second = await persistChatBackgroundImage('blob:second', 800);
  const firstUrl = await resolveChatBackgroundImageSource(first);
  assert.equal(fake.entries.size, 2);

  await pruneChatBackgroundImages([second]);

  assert.deepEqual(
    [...fake.entries.keys()].map((name) => `chat-bg:${name}`),
    [second],
  );
  // 删掉的那张也要把 object URL 收回去，否则它一直把整张图钉在内存里。
  assert.ok(fake.revoked.includes(firstUrl));

  await pruneChatBackgroundImages([]);
  assert.equal(fake.entries.size, 0);
});

test('web degrades to "no background" when IndexedDB is unavailable', async () => {
  // SSG（expo export 静态渲染）在 Node 里求值，压根没有 indexedDB。
  const withoutIndexedDb = loadWebModule({ withIndexedDb: false });
  assert.equal(
    await withoutIndexedDb.resolveChatBackgroundImageSource('chat-bg:bg-1.jpg'),
    null,
  );
  // 清理失败不该抛给登出流程。
  await withoutIndexedDb.pruneChatBackgroundImages([]);

  // 浏览器有 indexedDB 但禁用了站点数据：open 直接失败，同样只能退回底色。
  const denied = loadWebModule();
  denied.fake.failOpen();
  assert.equal(
    await denied.resolveChatBackgroundImageSource('chat-bg:bg-1.jpg'),
    null,
  );
  await denied.pruneChatBackgroundImages([]);
  await assert.rejects(() => denied.persistChatBackgroundImage('blob:x', 800));
});
