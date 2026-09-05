const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 大图查看器的「手机端与网页端能力对等」守卫。
//
// 网页版是后加的，很容易出现「web 有、原生没有」的偏移（或反过来）。这里钉住
// 三件事：保存的两个平台档导出面一致、原生档真的走系统相册、iOS 的相册写入
// 权限描述在（缺了会**硬崩**，见 ios/ 被 gitignore 的那条约定）。
const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const exportedNames = (source) =>
  [...source.matchAll(/export (?:async )?function (\w+)/g)]
    .map(([, name]) => name)
    .concat(
      [...source.matchAll(/export type (\w+)/g)].map(([, name]) => name),
    )
    .sort();

test('save-image keeps the same export surface on both platforms', () => {
  const native = read('src/utils/save-image.ts');
  const web = read('src/utils/save-image.web.ts');

  assert.deepEqual(
    exportedNames(native),
    exportedNames(web),
    '平台档导出面漂移：Metro 按平台择档，一边多导出一个符号，另一边的 import 会直接炸',
  );
  // 三态语义两边一致，调用方才能共用一套提示分支。
  for (const source of [native, web]) {
    for (const outcome of ["'saved'", "'denied'", "'failed'"]) {
      assert.match(source, new RegExp(outcome));
    }
  }
});

test('the native save path really writes to the system photo library', () => {
  const native = read('src/utils/save-image.ts');

  assert.match(native, /expo-media-library/);
  assert.match(native, /requestPermissionsAsync\(true\)/); // 仅写入权限
  assert.match(native, /downloadAsync/);
  assert.match(native, /saveToLibraryAsync/);
  // 入库后删缓存副本，别把图片留两份。
  assert.match(native, /deleteAsync/);
});

test('iOS declares the add-to-library permission the save flow needs', () => {
  const appJson = JSON.parse(read('app.json'));
  const infoPlist = appJson.expo.ios.infoPlist;

  assert.ok(
    infoPlist.NSPhotoLibraryAddUsageDescription,
    'saveToLibraryAsync 在 iOS 上没有 NSPhotoLibraryAddUsageDescription 会硬崩',
  );
});

test('the viewer drives zoom/save through the shared cross-platform pieces', () => {
  const viewer = read('src/components/ui/image-viewer.tsx');

  // 缩放走 ZoomableImage（PanResponder，两端共用），不是 web 专属实现。
  assert.match(viewer, /<ZoomableImage/);
  assert.match(
    viewer,
    /onLongPress=\{privacyMode === 'ephemeral' \? undefined : handleLongPress\}/,
  );
  assert.match(
    viewer,
    /cachePolicy=\{privacyMode === 'ephemeral' \? 'none' : 'memory-disk'\}/,
  );
  assert.match(viewer, /saveImageToLibrary/);

  const zoomable = read('src/components/ui/zoomable-image.tsx');
  assert.match(zoomable, /PanResponder\.create/);
  // 双指捏合是原生端的缩放手段，必须在平台无关的代码路径里。
  assert.match(zoomable, /touches\.length === 2/);
  // 关键不变量：手势主体（PanResponder 配置块）里不得有任何平台分支 ——
  // 捏合/双击/长按/平移必须两端同一份代码。web 只允许**额外**加滚轮。
  const responderStart = zoomable.indexOf('PanResponder.create');
  const responderEnd = zoomable.indexOf('// Web：滚轮');
  assert.ok(responderStart > 0 && responderEnd > responderStart);
  assert.doesNotMatch(
    zoomable.slice(responderStart, responderEnd),
    /Platform\.OS/,
    '手势主体出现平台分支：手机端会少掉能力',
  );
  assert.match(zoomable, /'wheel'/); // web 的额外增益仍在
});
