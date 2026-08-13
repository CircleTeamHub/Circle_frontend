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

// 窄屏 + 长语言(西语的这条标签比中文长得多)+ SQL 手改出的第四个档位一起
// 出现时,不换行的定宽行会把最后一个 chip 挤出屏幕。
test('验证人数那一行可以换行,标签可压缩', () => {
  const src = read('src/features/discover/components/circle-form-body.tsx');
  const row = src.slice(
    src.indexOf('verifierCountRow: {'),
    src.indexOf('verifierChip: {'),
  );
  assert.match(row, /flexWrap: 'wrap'/);
  // chip 容器自己也要能折行(第四档时)
  assert.equal((row.match(/flexWrap: 'wrap'/g) ?? []).length, 2);
  assert.match(src, /verifierCountLabel: \{ flexShrink: 1 \}/);
  assert.match(src, /s\.rowLabel, s\.verifierCountLabel/);
});

// 这条路由的实例可以从一张担保单换到另一张(参数变了但组件没重挂),旧请求
// 后落地就会把上一张单的候选人装进来 —— 点其中一个提交到新的 invitationId 上,
// 只会换来一句莫名其妙的资格失败。
test('选人页的候选名单钉在发起它的那张担保单上', () => {
  const src = read('src/features/discover/screens/SelectVerifierScreen.tsx');
  assert.match(src, /const loadedForRef = useRef<string \| null>\(null\)/);
  assert.match(src, /loadedForRef\.current = invitationId;/);
  // 成功、失败、收尾三条路径都要判
  assert.equal(
    (src.match(/loadedForRef\.current !== invitationId/g) ?? []).length,
    2,
  );
  assert.match(src, /if \(loadedForRef\.current === invitationId\) setLoading\(false\)/);
});

// 直接读 error.message 会把服务端原文弹给用户,serverErrors.<code> 的 5 语言
// 文案一条都用不上 —— 包括本 PR 新增的 CIRCLE_EDIT_FORBIDDEN。
test('编辑圈子的失败走错误码映射,不直接弹服务端原文', () => {
  const src = read('src/features/discover/screens/EditCircleScreen.tsx');
  assert.match(src, /import \{ getApiErrorMessage \} from '@\/services\/api\/errors'/);
  assert.match(src, /getApiErrorMessage\(error, t\('common\.errorOccurred'\)\)/);
  assert.doesNotMatch(src, /error instanceof Error \? error\.message : t\('common\.errorOccurred'\)/);
  // 这条码的 5 语言文案确实存在,映射才有意义
  for (const locale of LOCALES) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      dict.serverErrors?.CIRCLE_EDIT_FORBIDDEN,
      `${locale} 缺 serverErrors.CIRCLE_EDIT_FORBIDDEN`,
    );
  }
});
