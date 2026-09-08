import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_CONTACT_FIELDS,
  getVisibleProfileContacts,
} from './profile-contact.ts';

const full = {
  phone: '13800000000',
  email: 'tui@example.com',
  wechat: 'wxid_tui',
  qq: '10001',
};

test('renders one row per contact the server actually returned', () => {
  assert.deepEqual(
    getVisibleProfileContacts(full).map((row) => [row.id, row.value]),
    [
      ['phone', '13800000000'],
      ['email', 'tui@example.com'],
      ['wechat', 'wxid_tui'],
      ['qq', '10001'],
    ],
  );
});

test('a field the target hid comes back null and gets no row at all', () => {
  // 后端 applyProfilePrivacy 把 showEmail=false / showQQ=false 的字段置成 null。
  // 客户端不做第二次可见性判断,只认「有没有值」—— 这条断言就是那份契约。
  const rows = getVisibleProfileContacts({
    ...full,
    email: null,
    qq: null,
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ['phone', 'wechat'],
  );
});

test('blank and whitespace-only values are dropped, not rendered as empty rows', () => {
  // 用户清空过某个字段时列里留的是 '' 而不是 null,照样不能占一行。
  assert.deepEqual(
    getVisibleProfileContacts({
      phone: '',
      email: '   ',
      wechat: '\n\t',
      qq: ' 10001 ',
    }).map((row) => [row.id, row.value]),
    [['qq', '10001']],
  );
});

test('nothing visible (and a missing contact block) yields no card', () => {
  assert.deepEqual(
    getVisibleProfileContacts({
      phone: null,
      email: null,
      wechat: null,
      qq: null,
    }),
    [],
  );
  assert.deepEqual(getVisibleProfileContacts(null), []);
  assert.deepEqual(getVisibleProfileContacts(undefined), []);
});

test('row order matches the privacy toggle order, and every field carries its own icon/color/label key', () => {
  assert.deepEqual(
    PROFILE_CONTACT_FIELDS.map((field) => field.id),
    ['phone', 'email', 'wechat', 'qq'],
  );

  // 撞色/重复图标会让四行看起来像同一种联系方式,复制时容易点错。
  assert.equal(
    new Set(PROFILE_CONTACT_FIELDS.map((field) => field.color)).size,
    PROFILE_CONTACT_FIELDS.length,
  );
  assert.equal(
    new Set(PROFILE_CONTACT_FIELDS.map((field) => field.icon)).size,
    PROFILE_CONTACT_FIELDS.length,
  );
  for (const field of PROFILE_CONTACT_FIELDS) {
    assert.equal(field.labelKey, `profileFields.${field.id}`);
  }
});
