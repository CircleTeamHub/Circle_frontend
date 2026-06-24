// Behavioral test runner (React Testing Library on jest-expo). Scoped ONLY to
// *.spec.tsx so it never picks up the source-reading `node --test` suite
// (test/*.js, src/**/*.test.mts), which keeps running separately via `npm test`.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.spec.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
