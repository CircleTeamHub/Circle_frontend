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
