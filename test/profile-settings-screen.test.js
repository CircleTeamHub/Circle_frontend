const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('settings profile rows place city below birthday', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/screens/SettingsScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(
    /const PROFILE_ROW_IDS = \[([\s\S]*?)\] as const;/,
  );

  assert.ok(match, 'PROFILE_ROW_IDS should exist');

  const ids = Array.from(
    match[1].matchAll(/'([^']+)'/g),
    ([, value]) => value,
  );

  assert.deepEqual(
    ids,
    ['avatar', 'frame', 'nickname', 'gender', 'birthday', 'city', 'bio', 'wechat', 'phone', 'qq'],
  );
});

test('settings flow screens use i18n instead of hardcoded Chinese settings copy', () => {
  const screenFiles = [
    'src/features/profile/screens/SettingsScreen.tsx',
    'src/features/profile/screens/ChangePasswordScreen.tsx',
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
    'src/features/profile/screens/ShareScreen.tsx',
  ];

  for (const relativePath of screenFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(source, /useTranslation\(/, `${relativePath} should use react-i18next`);
  }

  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/SettingsScreen.tsx'),
      'utf8',
    ),
    /title="账号设置"|个人信息|账号与安全|切换账号|退出登录|切换语言/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/ChangePasswordScreen.tsx'),
      'utf8',
    ),
    /title="修改登录密码"|当前密码|新密码|确认新密码|保存/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/EditProfileFieldScreen.tsx'),
      'utf8',
    ),
    /title="编辑资料"|该字段暂不支持编辑|当前显示：|保存中\.\.\.|选择生日|选择省市/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/ShareScreen.tsx'),
      'utf8',
    ),
    /title="分享"|分享我的二维码|邀请码|复制邀请码|分享二维码/,
  );
});
