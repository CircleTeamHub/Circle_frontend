const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const jestConfig = require('../jest.config.js');

// Git worktrees are checked out inside this repo (see .gitignore). Each one is
// a full copy of the tree carrying its own src/**/*.spec.tsx, so jest must not
// collect them: the duplicates fail outright in checkouts without node_modules.
const worktreeCheckouts = [
  ['.worktrees', 'android-preprod-cd'],
  ['.codex-worktrees', 'ws-observability'],
  ['.claude', 'worktrees', 'sleepy-nightingale'],
];

const ownSpec = ['src', 'features', 'auth', 'screens', 'LoginScreen.spec.tsx'];

// Jest matches these patterns against absolute paths written with the host's
// native separator, so every pattern has to accept backslashes and slashes.
function nativePaths(segments) {
  return {
    windows: path.win32.join('C:', 'repo', ...segments),
    posix: path.posix.join('/repo', ...segments),
  };
}

// Same shape jest builds internally: one alternation over the pattern list.
function toMatcher(patterns) {
  assert.ok(
    Array.isArray(patterns) && patterns.length > 0,
    'expected a non-empty list of ignore patterns',
  );
  return new RegExp(patterns.join('|'));
}

for (const key of ['testPathIgnorePatterns', 'modulePathIgnorePatterns']) {
  test(`${key} hides worktree checkouts on Windows and POSIX`, () => {
    const matcher = toMatcher(jestConfig[key]);
    for (const checkout of worktreeCheckouts) {
      const paths = nativePaths([...checkout, ...ownSpec]);
      assert.match(paths.windows, matcher);
      assert.match(paths.posix, matcher);
    }
  });

  test(`${key} keeps this checkout's own spec files visible`, () => {
    const matcher = toMatcher(jestConfig[key]);
    const paths = nativePaths(ownSpec);
    assert.doesNotMatch(paths.windows, matcher);
    assert.doesNotMatch(paths.posix, matcher);
  });
}

test('testPathIgnorePatterns keeps the jest default for node_modules', () => {
  // Setting testPathIgnorePatterns replaces jest's default rather than adding
  // to it, so the node_modules default has to be listed again explicitly.
  const patterns = jestConfig.testPathIgnorePatterns ?? [];
  assert.ok(
    patterns.includes('/node_modules/'),
    'expected /node_modules/ to stay in testPathIgnorePatterns',
  );
});

test('modulePathIgnorePatterns leaves node_modules resolvable', () => {
  // modulePathIgnorePatterns makes matching files unresolvable as modules, so
  // listing node_modules there would break every import in the suite.
  const patterns = jestConfig.modulePathIgnorePatterns ?? [];
  assert.ok(
    !patterns.some((pattern) => pattern.includes('node_modules')),
    'expected modulePathIgnorePatterns to leave node_modules alone',
  );
});
