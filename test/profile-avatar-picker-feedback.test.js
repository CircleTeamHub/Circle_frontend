const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadAvatarPickerFeedback() {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/avatar-picker-feedback.ts',
  );
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
    require,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('avatar picker helper text explains local album access and simulator caveat', () => {
  const { AVATAR_PICKER_HELPER_TEXT } = loadAvatarPickerFeedback();

  assert.match(AVATAR_PICKER_HELPER_TEXT, /本地相册/);
  assert.match(AVATAR_PICKER_HELPER_TEXT, /模拟器/);
});

test('permission denied message distinguishes retryable vs settings cases', () => {
  const { getAvatarPickerPermissionDeniedMessage } =
    loadAvatarPickerFeedback();

  assert.equal(
    getAvatarPickerPermissionDeniedMessage({
      granted: false,
      canAskAgain: true,
    }),
    '请先允许访问相册。',
  );
  assert.match(
    getAvatarPickerPermissionDeniedMessage({
      granted: false,
      canAskAgain: false,
    }),
    /系统设置/,
  );
  assert.equal(
    getAvatarPickerPermissionDeniedMessage({
      granted: true,
      canAskAgain: true,
    }),
    null,
  );
});

test('avatar edit screen renders the local album CTA and helper text', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /从本地相册选择/);
  assert.match(source, /AVATAR_PICKER_HELPER_TEXT/);
});
