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
  const unguarded = SOURCE_DIRS.flatMap(walkSources).flatMap((rel) => {
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

test('Android group rename fallback guards duplicate submits while pending', () => {
  const source = readSource('src/features/messages/screens/GroupManagementScreen.tsx');

  assert.match(source, /const renameInFlightRef = useRef\(false\)/);
  assert.match(source, /const \[renameSubmitting, setRenameSubmitting\] = useState\(false\)/);
  assert.match(source, /if \(!renameTarget \|\| renameInFlightRef\.current\) return;/);
  assert.match(source, /renameInFlightRef\.current = true/);
  assert.match(source, /setRenameSubmitting\(true\)/);
  assert.match(source, /renameInFlightRef\.current = false/);
  assert.match(source, /setRenameSubmitting\(false\)/);
  assert.match(source, /disabled=\{renameSubmitting\}/);
  assert.match(source, /editable=\{!renameSubmitting\}/);
  assert.match(source, /onSubmitEditing=\{handleSubmitRename\}/);
});
