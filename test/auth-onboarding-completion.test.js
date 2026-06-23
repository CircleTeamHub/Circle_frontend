const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadOnboardingCompletion() {
  const filePath = path.join(process.cwd(), 'src/features/auth/onboarding-completion.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('onboarding is complete only after avatar and nickname exist', () => {
  const { hasCompletedOnboardingProfile } = loadOnboardingCompletion();

  assert.equal(
    hasCompletedOnboardingProfile({
      avatarUrl: 'https://cdn.example/avatar.jpg',
      nickname: 'Alice',
    }),
    true,
  );
  assert.equal(
    hasCompletedOnboardingProfile({
      avatarUrl: null,
      nickname: 'Alice',
    }),
    false,
  );
  assert.equal(
    hasCompletedOnboardingProfile({
      avatarUrl: 'https://cdn.example/avatar.jpg',
      nickname: '   ',
    }),
    false,
  );
});
