const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

// 圈子设置里的「入圈验证」开关:关 = requiredVerifierCount 1(拉人即进),
// 开 = 2/5/10 三档。BE 快照语义已就绪,这组钉住 FE 表单到 payload 的链路。
test('表单状态承载 requiredVerifierCount,默认 1(宣传期关闭态)', () => {
  const src = read('src/features/discover/hooks/use-circle-form.ts');
  assert.match(src, /requiredVerifierCount: number/);
  assert.match(src, /requiredVerifierCount: 1/);
  assert.match(src, /setRequiredVerifierCount/);
});

test('表单体渲染验证开关与 2/5/10 三档', () => {
  const src = read('src/features/discover/components/circle-form-body.tsx');
  assert.match(src, /VERIFIER_COUNT_OPTIONS = \[2, 5, 10\]/);
  assert.match(src, /verificationGateLabel/);
  assert.match(src, /verifierCountLabel/);
  // 开关语义:>1 = 开;打开默认 10,关闭回 1。
  assert.match(src, /requiredVerifierCount > 1/);
  assert.match(src, /setRequiredVerifierCount\(value \? 10 : 1\)/);
  // SQL 手改出的非 2/5/10 档位也要能显示,保存时不被静默改掉。
  assert.match(src, /VERIFIER_COUNT_OPTIONS\.includes/);
});

test('编辑页:从 detail 水合并随 PATCH 提交', () => {
  const src = read('src/features/discover/screens/EditCircleScreen.tssx'.replace('tssx','tsx'));
  assert.match(src, /requiredVerifierCount: data\.requiredVerifierCount \?\? 1/);
  assert.match(src, /requiredVerifierCount: form\.requiredVerifierCount/);
});

test('建圈页:开关值随 create 提交', () => {
  const src = read('src/features/discover/screens/CreateCircleScreen.tsx');
  assert.match(src, /requiredVerifierCount: form\.requiredVerifierCount/);
});

test('四条文案五种语言齐备', () => {
  for (const locale of LOCALES) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const create = dict.circle?.create ?? {};
    for (const key of [
      'verificationGateLabel',
      'verificationGateOffHint',
      'verificationGateOnHint',
      'verifierCountLabel',
    ]) {
      assert.ok(create[key], `${locale}.json 缺 circle.create.${key}`);
    }
  }
});

// 验证进度页此前把 10 写死在需求文案、进度分母、席位格子和「还能加人」四处 ——
// 圈子把档位调成 2 / 5 之后,申请人被告知需要十位好友验证,满席了还继续给
// 「添加验证人」。四处都必须走这张单子自己的 requiredCount 快照。
test('验证进度页的席位数来自 invitation.requiredCount,不写死 10', () => {
  const src = read(
    'src/features/discover/screens/InvitationVerificationScreen.tsx',
  );
  assert.doesNotMatch(src, /TOTAL_SLOTS/);
  assert.match(src, /const totalSlots = Math\.max\(\s*MIN_SLOTS,\s*invitation\?\.requiredCount \?\? MIN_SLOTS,?\s*\)/);
  // 需求文案与进度分母
  assert.match(src, /invitation\.requireVerifiers', \{ count: totalSlots \}/);
  assert.match(src, /total: totalSlots/);
  // 还能加人的判据
  assert.match(src, /activeVerifierCount < totalSlots/);
});

test('验证进度页的空位按「在用席位」补,被拒的席位会腾出来', () => {
  const src = read(
    'src/features/discover/screens/InvitationVerificationScreen.tsx',
  );
  // 服务端 activeSlots 同样不计 REJECTED,两边必须同口径,否则会出现
  // 「可以再加人」与「没有空位可点」同时成立。
  assert.match(
    src,
    /activeVerifierCount = invitation\s*\?\s*invitation\.verifiers\.filter\(\(v\) => v\.status !== 'REJECTED'\)\.length/,
  );
  assert.match(src, /Array\(Math\.max\(0, totalSlots - activeVerifierCount\)\)/);
});
