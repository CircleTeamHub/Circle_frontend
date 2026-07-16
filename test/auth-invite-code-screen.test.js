const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('registration screen renders and submits an optional invite code', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/auth/screens/RegisterScreen.tsx'),
    'utf8',
  );

  assert.match(source, /const \[inviteCode, setInviteCode\] = useState\(''\)/);
  assert.match(source, /auth\.inviteCode/);
  assert.match(source, /auth\.inviteCodePlaceholder/);
  assert.match(source, /onChangeText=\{setInviteCode\}/);
  assert.match(source, /register\(email, code, password, nickname, inviteCode\)/);
});
