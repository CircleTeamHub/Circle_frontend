const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function runtimeSources(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return runtimeSources(relativePath);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:spec|test)\./.test(entry.name)) {
      return [];
    }
    return [{ relativePath, source: read(relativePath) }];
  });
}

function stripNonTextSecondaryUses(source) {
  return source
    .replace(/<Ionicons\b[\s\S]*?\/>/g, '')
    .replace(/placeholderTextColor=\{colors\.textSecondary\}/g, '');
}

test('the floating composer keeps a transparent gap while respecting the device bottom inset', () => {
  const source = read(
    'src/features/chat/chat-detail/components/ChatComposerBar.tsx',
  );

  assert.doesNotMatch(source, /insets\.bottom\s*\|\|\s*28/);
  assert.match(source, /Math\.max\(insets\.bottom, 12\)/);
  assert.match(read('src/features/chat/chat-detail/hooks/use-chat-detail-themed-styles.ts'), /inputBar: \{ backgroundColor: 'transparent' \}/);
});

test('chat detail text uses the high-contrast text color', () => {
  const sources = [
    ...runtimeSources('src/features/chat/components/bubbles'),
    ...runtimeSources('src/features/chat/chat-detail'),
  ];
  const offenders = sources
    .filter(({ source }) =>
      stripNonTextSecondaryUses(source).includes('colors.textSecondary'),
    )
    .map(({ relativePath }) => relativePath.replaceAll('\\', '/'));

  assert.deepEqual(offenders, []);
});
