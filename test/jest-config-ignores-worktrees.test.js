const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// jest-config runs every ignore pattern through this before compiling it, which
// is how jest's own default '/node_modules/' matches Windows paths. Using the
// same transform here means the test exercises what jest actually matches on
// this host instead of a hand-rolled approximation of it.
const { replacePathSepForRegex } = require('jest-regex-util');

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

// Jest matches against absolute paths written with the host's native separator.
function nativePath(segments) {
  return path.resolve(path.sep, 'repo', ...segments);
}

// Same shape jest builds internally: normalize each pattern for this host, then
// one alternation over the list.
function toMatcher(patterns) {
  assert.ok(
    Array.isArray(patterns) && patterns.length > 0,
    'expected a non-empty list of ignore patterns',
  );
  return new RegExp(patterns.map(replacePathSepForRegex).join('|'));
}

for (const key of ['testPathIgnorePatterns', 'modulePathIgnorePatterns']) {
  test(`${key} hides worktree checkouts on this host`, () => {
    const matcher = toMatcher(jestConfig[key]);
    for (const checkout of worktreeCheckouts) {
      assert.match(nativePath([...checkout, ...ownSpec]), matcher);
    }
  });

  test(`${key} keeps this checkout's own spec files visible`, () => {
    const matcher = toMatcher(jestConfig[key]);
    assert.doesNotMatch(nativePath(ownSpec), matcher);
    // A directory that merely contains the word must not be swept up either.
    assert.doesNotMatch(
      nativePath(['src', 'worktrees-ui', 'Worktrees.spec.tsx']),
      matcher,
    );
  });

  test(`${key} is written with '/' like jest's own defaults`, () => {
    // Jest rewrites '/' to the host separator itself; a hand-written [\\/]
    // class would be rewritten too and only pretends to add portability.
    for (const pattern of jestConfig[key]) {
      assert.doesNotMatch(pattern, /\[\\\\\/\]/);
    }
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
