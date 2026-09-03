// Behavioral test runner (React Testing Library on jest-expo). Scoped ONLY to
// *.spec.tsx so it never picks up the source-reading `node --test` suite
// (test/*.js, src/**/*.test.mts), which keeps running separately via `npm test`.

// Git worktrees are checked out inside this repo (see .gitignore). Each one is
// a full copy of the tree with its own *.spec.tsx files and usually no
// node_modules, so an unfiltered run collects hundreds of duplicate specs that
// fail on import. Jest matches these against absolute paths using the host
// separator, hence the [\\/] classes rather than a plain '/'.
// Caveat: these patterns are not anchored at this checkout, so running jest
// from *inside* one of those worktrees ignores its own specs too ("No tests
// found"). Run the suite from the main checkout.
const nestedWorktreeCheckouts = [
  '[\\\\/]\\.worktrees[\\\\/]',
  '[\\\\/]\\.codex-worktrees[\\\\/]',
  '[\\\\/]\\.claude[\\\\/]worktrees[\\\\/]',
];

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.spec.tsx'],
  // Replaces jest's default, so '/node_modules/' has to be repeated here.
  testPathIgnorePatterns: ['/node_modules/', ...nestedWorktreeCheckouts],
  // Keeps the worktree copies out of the haste map, which also silences the
  // "Haste module naming collision" warnings their package.json files cause.
  modulePathIgnorePatterns: [...nestedWorktreeCheckouts],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@sentry/react-native$': '<rootDir>/test/jest/sentry-react-native.mock.js',
  },
};
