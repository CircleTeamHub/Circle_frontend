const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 面板正文没有可滚内容时，从任意位置下拉都会关面板（BottomSheetModal 的规则）。
// 所以面板里每个竖向滚动的东西都必须用接入面板的版本，否则它往上滚（手指往下）的
// 手势会被面板抢走，列表再也滚不回顶部。这里按源码扫一遍，拦住直接写进面板的
// ScrollView / FlatList / SectionList 和多行 TextInput。
const SRC = path.join(process.cwd(), 'src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.spec.') ? [full] : [];
  });
}

test('every vertical scrollable inside a bottom sheet is wired to the sheet', () => {
  const offenders = [];
  let sheets = 0;
  for (const file of sourceFiles(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
    let depth = 0;
    lines.forEach((line, index) => {
      if (/<BottomSheetModal\b/.test(line)) {
        depth += 1;
        sheets += 1;
      }
      if (depth > 0) {
        const opening = lines.slice(index, index + 14).join(' ');
        const tag = line.match(/<(ScrollView|FlatList|SectionList|TextInput)\b/)?.[1];
        const horizontal = /^[^>]*\bhorizontal\b/.test(opening.slice(opening.indexOf(`<${tag}`)));
        const multiline = /^[^>]*\bmultiline\b/.test(opening.slice(opening.indexOf(`<${tag}`)));
        if (tag && tag !== 'TextInput' && !horizontal) offenders.push(`${rel}:${index + 1} <${tag}>`);
        if (tag === 'TextInput' && multiline) offenders.push(`${rel}:${index + 1} <TextInput multiline>`);
      }
      if (/<\/BottomSheetModal>/.test(line)) depth -= 1;
    });
  }
  assert.ok(sheets > 20, `expected the sweep to find the app's sheets, found ${sheets}`);
  assert.deepEqual(
    offenders,
    [],
    `面板里的竖向滚动要用 BottomSheetScrollView / BottomSheetFlatList / BottomSheetTextInput：\n  ${offenders.join('\n  ')}`,
  );
});
