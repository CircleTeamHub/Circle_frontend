const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadAvatarPickerFeedback(stubs = {}) {
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
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('permission denied message distinguishes retryable vs settings cases', () => {
  const { getAvatarPickerPermissionDeniedMessage } =
    loadAvatarPickerFeedback({
      '@/i18n': {
        default: {
          t: (key) =>
            ({
              'profileFields.albumPermissionBlocked':
                '相册权限已被关闭，请到系统设置中允许风信访问相册后再试。',
              'validation.albumPermission': '请先允许访问相册。',
            }[key] ?? key),
        },
      },
    });

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

test('avatar edit screen renders only the local album CTA for avatar selection', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useTranslation\(/);
  assert.match(source, /profileFields\.selectFromAlbum/);
  assert.doesNotMatch(source, /getAvatarPickerHelperText\(\)/);
  assert.doesNotMatch(source, /profileFields\.currentDisplay/);
  assert.doesNotMatch(source, /从本地相册选择/);
});

test('avatar picker feedback copy is routed through i18n', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/avatar-picker-feedback.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /@\/i18n/);
  assert.match(source, /i18n\.t\(/);
  assert.doesNotMatch(source, /本地相册|模拟器|系统设置/);
});
