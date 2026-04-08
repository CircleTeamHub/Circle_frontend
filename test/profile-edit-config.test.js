const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfileEditConfig() {
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
    require,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('editable fields are exposed and unsupported rows stay non-editable', () => {
  const { PROFILE_EDIT_FIELDS, getProfileEditField } = loadProfileEditConfig();

  assert.equal(Array.isArray(PROFILE_EDIT_FIELDS), true);
  assert.equal(getProfileEditField('avatar').editable, true);
  assert.equal(getProfileEditField('avatar').editorType, 'avatar');
  assert.equal(getProfileEditField('nickname').editable, true);
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
    loadProfileEditConfig();

  assert.deepEqual(
    JSON.parse(JSON.stringify(toProfileUpdatePayload('bio', 'hello world'))),
    { persona: 'hello world' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(toProfileUpdatePayload('phone', '13800138000'))),
    { phoneNumber: '13800138000' },
  );
  assert.equal(formatProfileFieldValue('gender', ''), '未设置');
  assert.equal(formatProfileFieldValue('birthday', ''), '未设置');
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
  assert.match(validateProfileFieldValue('birthday', '2026-02-31'), /生日/);
  assert.match(validateProfileFieldValue('phone', '123'), /手机号/);
  assert.match(validateProfileFieldValue('wechat', '1abc'), /微信/);
  assert.match(validateProfileFieldValue('qq', '12'), /QQ/);
});
