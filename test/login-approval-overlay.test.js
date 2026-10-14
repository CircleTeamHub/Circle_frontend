const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// iOS 上两个从根 VC present 的 RN Modal 会互相拒绝：批准弹窗若用 Modal，开着时
// 切后台，应用锁的 Modal 就可能弹不出来（锁失效）。批准弹窗必须走 DialogOverlay。
test('the login approval prompt renders through DialogOverlay, not a React Native Modal', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/security/components/LoginApprovalHost.tsx'),
    'utf8',
  );
  assert.match(source, /from '@\/components\/app\/dialog-overlay'/);
  assert.match(source, /<DialogOverlay\b/);
  assert.doesNotMatch(source, /<Modal\b/);
  const rnImport = source.match(/import \{([^}]*)\} from 'react-native';/);
  assert.ok(rnImport, 'expected a react-native import');
  assert.doesNotMatch(rnImport[1], /\bModal\b/);
});

test('the app lock hides the approval prompt before it locks on backgrounding', () => {
  const gate = fs.readFileSync(
    path.join(process.cwd(), 'src/components/app/login-security-code-gate.tsx'),
    'utf8',
  );
  assert.match(
    gate,
    /setAppLocked\(true\);\s*setGateState\('locked'\);/,
  );
});
