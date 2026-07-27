const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('joining is universally vouch-gated — no public/approval toggle anywhere', () => {
  const hook = read('src/features/discover/hooks/use-circle-form.ts');
  const body = read('src/features/discover/components/circle-form-body.tsx');
  const create = read('src/features/discover/screens/CreateCircleScreen.tsx');

  // 产品规则：任何入口申请加入一律走担保验证（后端 joinCircle 恒 PENDING+担保单），
  // 建圈表单不再有「公开/需审核」开关。
  assert.doesNotMatch(hook, /requireJoinApproval/);
  assert.doesNotMatch(body, /requireApprovalLabel|showJoinApproval/);
  assert.doesNotMatch(create, /isPublic|showJoinApproval/);
});

test('circle form drops the duplicate tags section (categories only)', () => {
  const body = read('src/features/discover/components/circle-form-body.tsx');
  const hook = read('src/features/discover/hooks/use-circle-form.ts');
  const create = read('src/features/discover/screens/CreateCircleScreen.tsx');
  const edit = read('src/features/discover/screens/EditCircleScreen.tsx');

  // 标签与主题分类语义重复：UI 全部移除，只留主题分类。
  assert.doesNotMatch(body, /circle\.create\.tagsLabel/);
  assert.doesNotMatch(hook, /handleAddTag|tagInput/);
  assert.doesNotMatch(create, /tags: form\.tags/);
  // Edit 保留 tags 透传：编辑其它字段不清掉老圈子已有标签。
  assert.match(edit, /tags: form\.tags/);
});

test('circle avatar picker stays on the fast PHPicker path (no allowsEditing)', () => {
  const hook = read('src/features/discover/hooks/use-circle-form.ts');

  // allowsEditing 选项会让 iOS 回退到老 UIImagePickerController，
  // 大照片库时点击后要卡好几秒才弹出相册。（匹配属性语法，避免误中注释）
  assert.doesNotMatch(hook, /allowsEditing:/);
  assert.match(hook, /launchImageLibraryAsync/);
});

test('circle creation gate applies the shared membership rollout floor', () => {
  const create = read('src/features/discover/screens/CreateCircleScreen.tsx');
  const plans = read('src/features/profile/membership-plans.ts');

  assert.match(create, /useMembershipProgramStore/);
  assert.match(create, /resolveMembershipEntitlementLevel/);
  assert.match(create, /status\?\.entitlementFloorLevel \?\? 0/);
  assert.match(create, /entitlementLevel < 1/);
  assert.doesNotMatch(create, /user\.vipLevel < 1/);

  // The effective level must admit a regular user under the Gold rollout floor,
  // while still rejecting the same user when no floor applies.
  assert.match(plans, /Math\.max\(actualLevel, entitlementFloorLevel\)/);
});

test('vip/credit restrictions pick via bottom sheet with >= semantics', () => {
  const body = read('src/features/discover/components/circle-form-body.tsx');
  const hook = read('src/features/discover/hooks/use-circle-form.ts');

  // 点击弹 sheet 直选，而不是循环切换。
  assert.doesNotMatch(body, /cycleVip|cycleCredit/);
  assert.doesNotMatch(hook, /cycleVip|cycleCredit/);
  assert.match(body, /OptionPickerSheet/);
  assert.match(body, /setActiveRestrictionSheet\('vip'\)/);
  assert.match(body, /setActiveRestrictionSheet\('credit'\)/);
  assert.match(hook, /setJoinVipRestriction/);
  assert.match(hook, /setJoinCreditRestriction/);
  // 语义：所选等级及以上可加入。
  assert.match(body, /circle\.create\.vipAtLeast/);
});
