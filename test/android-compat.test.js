const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIRS = ['app', 'src'];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

function walkSources(dir) {
  const abs = path.join(process.cwd(), dir);
  if (!fs.existsSync(abs)) return [];

  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkSources(rel);
    }

    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [rel] : [];
  });
}

function readSource(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function getLine(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function getModalOpeningTags(source) {
  const tags = [];
  const modalTagPattern = /<Modal\b[\s\S]*?>/g;
  let match;
  while ((match = modalTagPattern.exec(source))) {
    tags.push({ tag: match[0], index: match.index });
  }
  return tags;
}

test('all React Native Modal usages handle Android hardware back', () => {
  const missing = SOURCE_DIRS.flatMap(walkSources).flatMap((rel) => {
    const source = readSource(rel);
    return getModalOpeningTags(source)
      .filter(({ tag }) => !/\bonRequestClose\s*=/.test(tag))
      .map(({ index }) => `${rel}:${getLine(source, index)}`);
  });

  assert.deepEqual(missing, []);
});

test('Alert.prompt calls are guarded for Android compatibility', () => {
  // spec 直接调 Alert.prompt 是为了验证 alert-bridge 的接管，不是业务调用点。
  const isSpec = (rel) => /\.spec\.tsx?$/.test(rel);
  const unguarded = SOURCE_DIRS.flatMap(walkSources).filter((rel) => !isSpec(rel)).flatMap((rel) => {
    const source = readSource(rel);
    const matches = [...source.matchAll(/Alert\.prompt\s*\(/g)];

    return matches
      .filter((match) => {
        const prefix = source.slice(Math.max(0, match.index - 600), match.index);
        return !/typeof\s+Alert\.prompt\s*!==\s*['"]function['"]/.test(prefix);
      })
      .map((match) => `${rel}:${getLine(source, match.index)}`);
  });

  assert.deepEqual(unguarded, []);
});

test('group rename is an inline field on every platform, saved by one guarded submit', () => {
  // 以前 iOS 走 Alert.prompt、安卓走自绘弹窗兜底；现在名称就在编辑页里，两端同一条路。
  const screen = readSource('src/features/messages/screens/GroupEditScreen.tsx');
  const form = readSource('src/features/messages/components/group-edit-form.tsx');
  const editor = readSource('src/features/messages/hooks/use-group-editor.ts');

  assert.doesNotMatch(screen, /Alert\.prompt/);
  assert.match(form, /<TextInput[\s\S]*onChangeText=\{onChangeName\}/);
  assert.match(editor, /if \(savingRef\.current \|\| !trimmed\) return false;/);
  assert.match(editor, /savingRef\.current = false/);
  assert.match(screen, /disabled=\{!editor\.canSave\}/);
});
