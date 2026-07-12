const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('plaza post detail shows a join CTA for non-members instead of "not found"', () => {
  const src = read(
    'src/features/discover/screens/PlazaPostDetailScreen.tsx',
  );
  // 识别「非本圈成员」错误码，并从 err.data 取回圈子信息（circleId/circleName）。
  assert.match(src, /err\.errorCode === 'PLAZA_NOT_CIRCLE_MEMBER'/);
  assert.match(src, /err\.data/);
  assert.match(src, /setRestricted\(/);
  // 「申请加入圈子」→ joinCircle(circleId)。
  assert.match(src, /joinCircle\(restricted\.circleId\)/);
  assert.match(src, /plaza\.postDetail\.joinCircle/);
});

test('PLAZA_NOT_CIRCLE_MEMBER is mirrored in the frontend server error codes', () => {
  const codes = read('src/services/api/server-error-codes.ts');
  assert.match(codes, /PLAZA_NOT_CIRCLE_MEMBER/);
});
