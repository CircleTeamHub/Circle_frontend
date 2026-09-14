const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/discover/screens/VerificationRequestScreen.tsx';

test('verify screen distinguishes applicant from verifier — only a verifier can respond', () => {
  const src = read(SRC);
  assert.match(src, /useAuthStore/);
  assert.match(
    src,
    /const isApplicant = invitation\.applicant\.id === currentUserId/,
  );
  assert.match(src, /invitation\.verifiers\.find\(/);
  // The approve/reject buttons are gated on being a still-pending verifier,
  // so the applicant (and already-responded verifiers) never see them.
  assert.match(
    src,
    /const canRespond = !settled && myVerifier\?\.status === 'PENDING'/,
  );
});

test('verify screen shows post-response and settled states instead of buttons', () => {
  const src = read(SRC);
  assert.match(src, /myResponded/);
  assert.match(src, /你已帮 TA 验证/);
  assert.match(src, /你已拒绝该申请/);
  assert.match(src, /该申请已通过/);
  // The applicant gets a waiting state, not actions.
  assert.match(src, /正在等待好友验证/);
});

test('verify screen renders a progress bar', () => {
  const src = read(SRC);
  assert.match(src, /progressFill/);
  assert.match(src, /Math\.round\(ratio \* 100\)/);
});

// 服务端会把失效的申请收成 CANCELLED：它不是通过，不能落进「已通过」的绿勾分支。
test('verify screen renders a cancelled request distinctly from an approved one', () => {
  const src = read(SRC);
  const cancelledAt = src.indexOf("invitation.status === 'CANCELLED'");
  const approvedAt = src.indexOf('invitation.settledApproved');
  assert.notEqual(cancelledAt, -1);
  assert.match(src, /invitation\.settledCancelled/);
  assert.ok(
    cancelledAt < approvedAt,
    'CANCELLED must be handled before the approved fallback branch',
  );
});
