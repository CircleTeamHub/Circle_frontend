const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('create circle exposes the join-approval switch and maps it to isPublic', () => {
  const hook = read('src/features/discover/hooks/use-circle-form.ts');
  const body = read('src/features/discover/components/circle-form-body.tsx');
  const create = read('src/features/discover/screens/CreateCircleScreen.tsx');
  const types = read('src/types/index.ts');

  // 表单字段 + setter
  assert.match(hook, /requireJoinApproval: boolean/);
  assert.match(hook, /requireJoinApproval: false/);
  assert.match(hook, /setRequireJoinApproval/);
  // 开关只在建圈页出现（编辑页后端 PATCH 不支持 isPublic，不显示假开关）
  assert.match(body, /showJoinApproval = false/);
  assert.match(body, /circle\.create\.requireApprovalLabel/);
  assert.match(create, /<CircleFormBody form=\{form\} showJoinApproval \/>/);
  // 开 = 私密圈（isPublic=false），joinCircle 会走 PENDING + 担保审核
  assert.match(create, /isPublic: !form\.requireJoinApproval/);
  assert.match(types, /isPublic\?: boolean/);
});

test('edit circle keeps the join-approval switch hidden', () => {
  const edit = read('src/features/discover/screens/EditCircleScreen.tsx');
  assert.doesNotMatch(edit, /showJoinApproval/);
});
