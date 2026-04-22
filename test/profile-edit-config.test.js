const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfileEditConfig(stubs = {}) {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/profile-edit-config.ts',
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

test('editable fields are exposed and unsupported rows stay non-editable', () => {
  const { PROFILE_EDIT_FIELDS, getProfileEditField } = loadProfileEditConfig({
    '@/i18n': {
      default: {
        t: (key) => key,
      },
    },
  });

  assert.equal(Array.isArray(PROFILE_EDIT_FIELDS), true);
  assert.equal(getProfileEditField('avatar').editable, true);
  assert.equal(getProfileEditField('avatar').editorType, 'avatar');
  assert.equal(getProfileEditField('nickname').editable, true);
  assert.equal(getProfileEditField('city').editable, true);
  assert.equal(getProfileEditField('city').editorType, 'city');
  assert.equal(getProfileEditField('bio').editable, true);
  assert.equal(getProfileEditField('wechat').editable, true);
  assert.equal(getProfileEditField('password').editable, false);
});

test('payload mapping uses backend field names', () => {
  const {
    toProfileUpdatePayload,
    formatProfileFieldValue,
    validateProfileFieldValue,
  } =
    loadProfileEditConfig({
      '@/i18n': {
        default: {
          t: (key) =>
            ({
              'profileFields.notSet': '未设置',
              'profileFields.genderNotSet': '未设置',
              'profileFields.male': '男',
              'profileFields.female': '女',
              'profileFields.other': '其他',
              'validation.nicknameEmpty': '昵称不能为空',
              'validation.nicknameTooLong': '昵称最多 24 个字符',
              'validation.invalidGender': '性别只能选择男、女或未设置',
              'validation.invalidBirthday': '生日格式不正确，请选择有效日期',
              'validation.invalidCity': '地区格式不正确',
              'validation.bioTooLong': '个人简介最多 200 个字符',
              'validation.invalidWechat': '微信号格式不正确',
              'validation.invalidPhone': '手机号格式不正确',
              'validation.invalidQQ': 'QQ 号格式不正确',
            }[key] ?? key),
        },
      },
    });

  assert.deepEqual(
    JSON.parse(JSON.stringify(toProfileUpdatePayload('bio', 'hello world'))),
    { persona: 'hello world' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(toProfileUpdatePayload('phone', '13800138000'))),
    { phoneNumber: '13800138000' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(toProfileUpdatePayload('city', ' 杭州 '))),
    { city: '杭州' },
  );
  assert.equal(formatProfileFieldValue('gender', ''), '未设置');
  assert.equal(formatProfileFieldValue('birthday', ''), '未设置');
  assert.equal(formatProfileFieldValue('city', ''), '未设置');
  assert.equal(formatProfileFieldValue('city', '杭州'), '杭州');
  assert.equal(
    formatProfileFieldValue('birthday', '2000-01-01T00:00:00.000Z'),
    '2000-01-01',
  );
  assert.equal(formatProfileFieldValue('gender', 'male'), '男');
  assert.equal(formatProfileFieldValue('gender', 'female'), '女');
  assert.deepEqual(
    JSON.parse(JSON.stringify(toProfileUpdatePayload('gender', '女'))),
    { gender: 'female' },
  );
  assert.equal(validateProfileFieldValue('gender', '男'), null);
  assert.equal(validateProfileFieldValue('city', '杭州'), null);
  assert.match(validateProfileFieldValue('city', 'A'), /地区/);
  assert.match(validateProfileFieldValue('birthday', '2026-02-31'), /生日/);
  assert.match(validateProfileFieldValue('phone', '123'), /手机号/);
  assert.match(validateProfileFieldValue('wechat', '1abc'), /微信/);
  assert.match(validateProfileFieldValue('qq', '12'), /QQ/);
});

test('profile edit config resolves labels through i18n helpers instead of hardcoded copy', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/profile-edit-config.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /@\/i18n/);
  assert.match(source, /i18n\.t\(/);
  assert.doesNotMatch(source, /label: '头像'|title: '修改头像'|placeholder: '请输入昵称'/);
});
