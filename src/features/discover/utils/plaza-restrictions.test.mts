import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRestrictionReasonText } from './plaza-restrictions.ts';

const t = (key: string, options?: Record<string, unknown>) =>
  (options?.defaultValue as string) ?? key;

test('joins every visible requirement', () => {
  const text = buildRestrictionReasonText(
    { vipLevel: 2, creditScore: 80, fancyNumber: false },
    t,
    { showFancyNumber: false },
  );
  assert.equal(text, 'VIP2以上、信用值80以上');
});

// 靓号功能在前端是关掉的：后端只因为它判定不可报名/不可查看时，一条可展示的
// 理由都没有 —— 调用方必须退回通用说明，不能弹出「报名需满足：」这种半截话。
test('returns an empty string when the only requirement is hidden', () => {
  const text = buildRestrictionReasonText(
    { vipLevel: null, creditScore: null, fancyNumber: true },
    t,
    { showFancyNumber: false },
  );
  assert.equal(text, '');
});

test('returns an empty string when there is no requirement at all', () => {
  const text = buildRestrictionReasonText(
    { vipLevel: null, creditScore: null, fancyNumber: false },
    t,
    { showFancyNumber: false },
  );
  assert.equal(text, '');
});

test('includes the fancy-number requirement once the flag is on', () => {
  const text = buildRestrictionReasonText(
    { vipLevel: null, creditScore: null, fancyNumber: true },
    t,
    { showFancyNumber: true },
  );
  assert.equal(text, '靓号用户');
});
