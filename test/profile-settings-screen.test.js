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
