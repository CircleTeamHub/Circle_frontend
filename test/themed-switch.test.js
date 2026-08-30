const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 开关配色的两道守卫。
//
// 背景：react-native-web 的 Switch 打开态只读 activeThumbColor，`thumbColor`
// 仅作用于关闭态；不传就退回 RNW 默认的 #009688（Material 青绿）——网页版
// 每个打开的开关都会是绿滑块（用户实机撞到）。修法是收口到 ThemedSwitch，
// 由它在 web 注入 activeThumbColor。这里钉住两件事：
//   1. 业务代码不许再直接用 react-native 的 Switch（漏传即复发）；
//   2. ThemedSwitch 自己必须保留 web 注入这一行。
const ROOTS = ['src', 'app'];
const ALLOWED = new Set(['src/components/ui/themed-switch.tsx']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

test('business code never uses the raw react-native Switch', () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of walk(path.join(process.cwd(), root))) {
      const relative = path
        .relative(process.cwd(), file)
        .split(path.sep)
        .join('/');
      if (ALLOWED.has(relative)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (/<Switch\b/.test(source)) offenders.push(relative);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '这些文件直接用了 react-native 的 Switch，web 上打开态会是 RNW 默认的' +
      ' 绿滑块。请改用 @/components/ui/themed-switch 的 ThemedSwitch：\n' +
      offenders.join('\n'),
  );
});

test('ThemedSwitch injects the web-only active thumb color', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ui/themed-switch.tsx'),
    'utf8',
  );

  assert.match(source, /activeThumbColor/);
  assert.match(source, /Platform\.OS === 'web'/);
  assert.match(source, /thumbColor=\{colors\.white\}/);
});
