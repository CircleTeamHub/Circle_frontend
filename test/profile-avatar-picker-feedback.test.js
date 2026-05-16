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

test('avatar picker helper text explains local album access and simulator caveat', () => {
  const { getAvatarPickerHelperText } = loadAvatarPickerFeedback({
    '@/i18n': {
      default: {
        t: (key) =>
          ({
            'profileFields.avatarPickerHelper':
              '从本地相册选择头像。首次会请求相册权限；如果模拟器相册为空，请先导入照片或改用真机。',
          }[key] ?? key),
      },
    },
  });

  const text = getAvatarPickerHelperText();
  assert.match(text, /本地相册/);
  assert.match(text, /模拟器/);
});

test('permission denied message distinguishes retryable vs settings cases', () => {
  const { getAvatarPickerPermissionDeniedMessage } =
    loadAvatarPickerFeedback({
      '@/i18n': {
        default: {
          t: (key) =>
            ({
              'profileFields.albumPermissionBlocked':
                '相册权限已被关闭，请到系统设置中允许 Circle IM 访问相册后再试。',
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

test('avatar edit screen renders the local album CTA and helper text', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useTranslation\(/);
  // 改造后用函数调用避免模块加载时锁定字符串 —— 之前 const 在用户切换语言后会留旧值。
  assert.match(source, /getAvatarPickerHelperText\(\)/);
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
