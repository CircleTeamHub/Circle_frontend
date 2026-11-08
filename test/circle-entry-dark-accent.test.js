const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 圈子入口(圈子 tab 及其通知/报名页)。
const ENTRY_DIRS = ['src/features/discover', 'src/features/notifications'];

function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// colors.primary(#6366F1)在暗底上发暗(surface 上 3.9:1)。文字、图标、转圈这类前景色
// 必须用 iconAccent:浅色下它和 primary 同值,暗色下是提亮紫。紫底白字的按钮背景不受影响。
const FOREGROUND_PRIMARY = [
  /\bcolor\s*:\s*colors\.primary\b(?![A-Za-z])/,
  /\bcolor\s*:[^,}\n]*\?\s*colors\.primary\b(?![A-Za-z])/,
  /\bcolor=\{colors\.primary\}/,
  /\btone\s*=\s*colors\.primary\b(?![A-Za-z])/,
];

// 白色圆底上的叉号:提亮紫在白底上只有 2.6:1,这里必须留深色前景。
const ALLOWED = [
  { file: 'src/features/discover/screens/FilterScreen.tsx', line: /name="close"/ },
];

test('circle entry foreground purple uses the dark-mode accent, not colors.primary', () => {
  const offenders = [];
  for (const dir of ENTRY_DIRS) {
    for (const rel of listSources(dir)) {
      const file = rel.split(path.sep).join('/');
      read(rel)
        .split('\n')
        .forEach((line, index) => {
          if (!FOREGROUND_PRIMARY.some((re) => re.test(line))) return;
          if (ALLOWED.some((a) => a.file === file && a.line.test(line))) return;
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }
  }
  assert.deepEqual(offenders, [], `暗色下发暗的前景紫:\n${offenders.join('\n')}`);
});

test('iconAccent equals primary in light mode and is the bright accent in dark mode', () => {
  const colors = read('src/theme/colors.ts');
  const block = (name) => colors.slice(colors.indexOf(`export const ${name}`));
  // 浅色:前景换成 iconAccent 必须像素不变。
  assert.match(block('lightColors'), /iconAccent:\s*PRIMARY,/);
  // 暗色:提亮紫,与 tab 选中态同源。
  assert.match(block('darkColors'), /iconAccent:\s*DARK_ACCENT,/);
  assert.match(colors, /const DARK_ACCENT = '#B18AFF';/);
});
