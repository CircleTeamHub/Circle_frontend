const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

// 验证人资格 = 好友 ∩ 本圈 ACTIVE 成员。选人页以前拉的是**全部好友**,不在圈里
// 的也照列,点下去才被服务端 VerifierNotMember 打回。规则归服务端所有,列表就得
// 由服务端算好再给 —— 前端一旦自己做集合运算,同一条规则会在两个仓里各自漂移。
test('SelectVerifierScreen 拉的是服务端算好的候选人，不是全部好友', () => {
  const src = read('src/features/discover/screens/SelectVerifierScreen.tsx');

  assert.match(src, /fetchEligibleVerifiers/);
  assert.doesNotMatch(
    src,
    /fetchFriends/,
    '不能再拉全部好友：圈外好友点了必然被服务端打回',
  );
  assert.doesNotMatch(src, /from '@\/services\/api\/friends'/);
});

test('circles API 暴露 eligible-verifiers 端点', () => {
  const src = read('src/services/api/circles.ts');

  assert.match(src, /export async function fetchEligibleVerifiers/);
  assert.match(src, /\/circle-invitation\/\$\{invitationId\}\/eligible-verifiers/);
});

test('候选人空态文案讲清楚是「交集」为空，五种语言齐备', () => {
  for (const locale of LOCALES) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      dict.invitation?.noEligibleVerifiers,
      `${locale}.json 缺 invitation.noEligibleVerifiers`,
    );
  }
});

// 服务端补上了「好友」那一半的校验,FE 词表必须同步认得这个码,
// 否则用户拿到的是兜底的通用错误文案(见 api-error-localization 契约测试)。
test('INVITATION_VERIFIER_NOT_FRIEND 五种语言都有文案', () => {
  for (const locale of LOCALES) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      dict.serverErrors?.INVITATION_VERIFIER_NOT_FRIEND,
      `${locale}.json 缺 serverErrors.INVITATION_VERIFIER_NOT_FRIEND`,
    );
  }
});
