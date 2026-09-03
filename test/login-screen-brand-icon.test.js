const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('login sky uses the existing app logo plane asset without an app-icon frame', () => {
  const sky = read('src/features/auth/components/LoginSky.tsx');
  const screen = read('src/features/auth/screens/LoginScreen.tsx');

  assert.match(sky, /APP_LOGO_SOURCE/);
  assert.match(sky, /assets\/images\/login-logo-plane\.png/);
  assert.match(sky, /<Animated\.Image|<Image/);
  assert.match(screen, /<LoginSky/);
  for (const source of [sky, screen]) {
    assert.doesNotMatch(source, /Ionicons/);
    assert.doesNotMatch(source, /paper-plane/);
    assert.doesNotMatch(source, /logoShell/);
    assert.doesNotMatch(source, /logoOuter/);
    assert.doesNotMatch(source, /logoMiddle/);
    assert.doesNotMatch(source, /logoDot/);
  }
});

test('login logo asset is transparent and does not carry the white app-icon background', () => {
  const { PNG } = require('pngjs');
  const bytes = fs.readFileSync(
    path.join(process.cwd(), 'assets/images/login-logo-plane.png'),
  );
  const image = PNG.sync.read(bytes);
  let visible = 0;
  let visibleWhite = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const a = image.data[i + 3];
      if (a > 10) {
        visible += 1;
        if (r > 245 && g > 245 && b > 245) visibleWhite += 1;
      }
    }
  }

  assert.ok(visible > 50000);
  assert.equal(visibleWhite, 0);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[(image.width - 1) * 4 + 3], 0);
  assert.equal(image.data[((image.height - 1) * image.width) * 4 + 3], 0);
  assert.equal(image.data[(image.height * image.width - 1) * 4 + 3], 0);
});

test('login screen follows the night-flight layout: sky hero, no slogan, reserved message slot', () => {
  const source = read('src/features/auth/screens/LoginScreen.tsx');

  // 夜航定稿去掉了 slogan，登录页只保留标题 + 表单。
  assert.doesNotMatch(source, /让聊天/);
  assert.doesNotMatch(source, /splash-tagline/);
  // hero 是绝对定位的天空，表单从设计稿的 contentTop 开始，跟着屏宽缩放。
  assert.match(source, /getSkyLayout\(/);
  assert.match(source, /paddingTop:\s*sky\.contentTop/);
  assert.match(source, /paddingBottom:\s*insets\.bottom \+ 24/);
  // 登录方式切换与主按钮拆成独立组件，便于两个主题各自处理光效。
  assert.match(source, /<LoginModeSegment/);
  assert.match(source, /<LoginPrimaryButton/);
  // 错误 / 离线提示占位始终保留，按钮不会因提示出现而跳动。槽里只放一条按优先级
  // 选出来的消息、上限两行，所以按两行(2 × lineHeight 18)预留高度。
  assert.match(source, /messageSlot:\s*\{[^}]*minHeight:\s*36/);
  assert.match(source, /message:\s*\{[^}]*lineHeight:\s*18/);
  // 「忘记密码」那行不能写死高度：系统字号调大或译文更长时会溢出压到提示槽上。
  assert.match(source, /forgotRow:\s*\{[^}]*minHeight:\s*18/);
  assert.doesNotMatch(source, /forgotRow:\s*\{[^}]*[^n]height:\s*18/);
  // 键盘：iOS 用 padding 避让，安卓靠 adjustResize；拖动列表收起键盘。
  assert.match(source, /KeyboardAvoidingView/);
  assert.match(source, /\{\.\.\.keyboardDismissOnDragProps\}/);
  // 链接用 link token（暗色 #6366F1 在 #1A1B23 上不够对比度），不再直接用 primary。
  assert.match(source, /colors\.link/);
  assert.doesNotMatch(source, /color:\s*colors\.primary\b/);
});
