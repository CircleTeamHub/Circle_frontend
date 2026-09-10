const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('registration screen renders and submits an optional invite code', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/auth/screens/RegisterScreen.tsx'),
    'utf8',
  );

  assert.match(
    source,
    /const \[inviteCode, setInviteCode\] = useState\(\(\) =>/,
  );
  assert.match(source, /inviteCodeParam\.trim\(\)\.toUpperCase\(\)/);
  assert.match(source, /auth\.inviteCode/);
  assert.match(source, /auth\.inviteCodePlaceholder/);
  assert.match(source, /setInviteCode\(value\.toUpperCase\(\)\)/);
  assert.match(
    source,
    /register\(\s*email,\s*code,\s*password,\s*confirmPassword,\s*nickname,\s*inviteCode,?\s*\)/,
  );
});

test('registration requires both email verification and password confirmation', () => {
  const screen = fs.readFileSync(
    path.join(process.cwd(), 'src/features/auth/screens/RegisterScreen.tsx'),
    'utf8',
  );
  const api = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/auth.ts'),
    'utf8',
  );

  assert.match(screen, /const \[confirmPassword, setConfirmPassword\]/);
  assert.match(screen, /auth\.confirmPassword/);
  assert.match(screen, /useSendEmailCode\(["']register["']\)/);
  assert.match(screen, /sendCode|codePlaceholder/);
  assert.match(api, /requestEmailCode|auth\/email\/request-code/);
  assert.match(api, /code: payload\.code\.trim\(\)/);
  assert.match(api, /confirmPassword: payload\.confirmPassword/);
});
