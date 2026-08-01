import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MEMBERSHIP_BENEFITS,
  MEMBERSHIP_PLANS,
  getCityFilterLimit,
  getMembershipTierForVipLevel,
  resolveMembershipEntitlementLevel,
} from './membership-plans.ts';

test('catalog defines the four exact membership plans', () => {
  assert.deepEqual(MEMBERSHIP_PLANS, [
    {
      tier: 'silver',
      level: 1,
      nameKey: 'profile.membership.tiers.silver.name',
      duration: { type: 'months', months: 1 },
      price: { currency: 'CNY', amount: 298 },
      recommended: false,
    },
    {
      tier: 'gold',
      level: 2,
      nameKey: 'profile.membership.tiers.gold.name',
      duration: { type: 'months', months: 6 },
      price: { currency: 'CNY', amount: 1288 },
      recommended: false,
    },
    {
      tier: 'diamond',
      level: 3,
      nameKey: 'profile.membership.tiers.diamond.name',
      duration: { type: 'months', months: 12 },
      price: { currency: 'CNY', amount: 1998 },
      recommended: true,
    },
    {
      tier: 'super',
      level: 4,
      nameKey: 'profile.membership.tiers.super.name',
      duration: { type: 'lifetime' },
      price: { currency: 'CNY', amount: 3998 },
      recommended: false,
    },
  ]);
});

test('catalog defines every value in the seven benefit rows', () => {
  assert.deepEqual(MEMBERSHIP_BENEFITS, [
    {
      id: 'group-member-limit',
      labelKey: 'profile.membership.benefits.groupMemberLimit',
      values: { silver: 200, gold: 400, diamond: 1000, super: 3000 },
    },
    {
      id: 'joined-groups',
      labelKey: 'profile.membership.benefits.joinedCircles',
      values: { silver: 200, gold: 300, diamond: 1000, super: 2000 },
    },
    {
      id: 'note-storage',
      labelKey: 'profile.membership.benefits.noteStorage',
      values: { silver: 100, gold: 500, diamond: 1000, super: 3000 },
    },
    {
      id: 'city-filters',
      labelKey: 'profile.membership.benefits.cityFilters',
      values: { silver: 2, gold: 10, diamond: 50, super: 'unlimited' },
    },
    {
      id: 'fancy-number',
      labelKey: 'profile.membership.benefits.fancyNumber',
      values: {
        silver: 'none',
        gold: 'none',
        diamond: 'none',
        super: 'permanent',
      },
    },
    {
      id: 'name-color',
      labelKey: 'profile.membership.benefits.nameColor',
      values: {
        silver: 'silver',
        gold: 'gold',
        diamond: 'rainbow',
        super: 'exclusive-shimmer',
      },
    },
    {
      id: 'badge',
      labelKey: 'profile.membership.benefits.badge',
      values: {
        silver: 'silver',
        gold: 'gold',
        diamond: 'diamond',
        super: 'super-lifetime',
      },
    },
  ]);
});

test('joined-circle quota copy names circles in every supported locale', () => {
  const expected = {
    en: ['Circles you can join', '{{value}} circles'],
    es: ['Círculos a los que puedes unirte', '{{value}} círculos'],
    ja: ['参加可能なサークル', '{{value}}サークル'],
    ko: ['가입 가능한 서클', '{{value}}개 서클'],
    zh: ['可加入圈子', '{{value}} 个圈子'],
  } as const;

  for (const [locale, copy] of Object.entries(expected)) {
    const messages = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${locale}.json`),
        'utf8',
      ),
    );
    assert.deepEqual(
      [
        messages.profile.membership.benefits.joinedCircles,
        messages.profile.membership.benefitValues['joined-groups'],
      ],
      copy,
      `${locale} must describe the hard limit as circles`,
    );
  }
});

test('catalog excludes benefits reserved for the base product or later releases', () => {
  const benefitIds = MEMBERSHIP_BENEFITS.map((benefit) => benefit.id);

  assert.equal(benefitIds.length, 7);
  assert.equal(benefitIds.includes('created-groups'), false);
  assert.equal(benefitIds.includes('premium-circle'), false);
  assert.equal(benefitIds.includes('voice-to-text'), false);
  assert.equal(benefitIds.includes('avatar-frame'), false);
  assert.equal(benefitIds.includes('animated-avatar'), false);
});

test('legacy VIP levels map to the four membership tiers', () => {
  assert.equal(getMembershipTierForVipLevel(Number.NaN), null);
  assert.equal(getMembershipTierForVipLevel(Number.POSITIVE_INFINITY), null);
  assert.equal(getMembershipTierForVipLevel(Number.NEGATIVE_INFINITY), null);
  assert.equal(getMembershipTierForVipLevel(-1), null);
  assert.equal(getMembershipTierForVipLevel(0), null);
  assert.equal(getMembershipTierForVipLevel(1), 'silver');
  assert.equal(getMembershipTierForVipLevel(2), 'gold');
  assert.equal(getMembershipTierForVipLevel(3), 'diamond');
  assert.equal(getMembershipTierForVipLevel(4), 'super');
  assert.equal(getMembershipTierForVipLevel(5), 'super');
  assert.equal(getMembershipTierForVipLevel(99), 'super');
});

test('city filter limit follows the per-tier city-filters entitlement', () => {
  // 与权益目录逐档对齐（silver 2 / gold 10 / diamond 50 / super 无限）。
  assert.equal(getCityFilterLimit(1), 2); // silver
  assert.equal(getCityFilterLimit(2), 10); // gold
  assert.equal(getCityFilterLimit(3), 50); // diamond
  assert.equal(getCityFilterLimit(4), 'unlimited'); // super
  assert.equal(getCityFilterLimit(99), 'unlimited'); // 顶档封顶仍是 super
  // 非会员返回 null → 调用方用通用默认，不在此收紧免费用户。
  assert.equal(getCityFilterLimit(0), 0);
  assert.equal(getCityFilterLimit(-1), 0);

  // helper 的返回必须与目录里的 city-filters 值一致（防止两处漂移）。
  const cityFilters = MEMBERSHIP_BENEFITS.find((b) => b.id === 'city-filters');
  assert.equal(cityFilters?.values.silver, 2);
  assert.equal(cityFilters?.values.diamond, 50);
  assert.equal(cityFilters?.values.super, 'unlimited');
});

test('rollout floor raises entitlements without lowering higher tiers', () => {
  assert.equal(resolveMembershipEntitlementLevel(0, 2), 2);
  assert.equal(resolveMembershipEntitlementLevel(1, 2), 2);
  assert.equal(resolveMembershipEntitlementLevel(2, 2), 2);
  assert.equal(resolveMembershipEntitlementLevel(3, 2), 3);
  assert.equal(resolveMembershipEntitlementLevel(4, 0), 4);
  assert.equal(resolveMembershipEntitlementLevel(99, 0), 4);
  assert.equal(resolveMembershipEntitlementLevel(Number.NaN, 0), 0);
});
