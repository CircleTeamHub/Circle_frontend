import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBERSHIP_BENEFITS,
  MEMBERSHIP_PLANS,
  getMembershipTierForVipLevel,
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
    {
      id: 'group-member-limit',
      labelKey: 'profile.membership.benefits.groupMemberLimit',
      values: { silver: 300, gold: 500, diamond: 1000, super: 3000 },
    },
    {
      id: 'joined-groups',
      labelKey: 'profile.membership.benefits.joinedGroups',
      values: { silver: 200, gold: 500, diamond: '999+', super: 'unlimited' },
    },
    {
      id: 'note-storage',
      labelKey: 'profile.membership.benefits.noteStorage',
      values: { silver: 100, gold: 500, diamond: '999+', super: 'unlimited' },
    },
    {
      id: 'city-filters',
      labelKey: 'profile.membership.benefits.cityFilters',
      values: { silver: 5, gold: 20, diamond: 50, super: 'unlimited' },
    },
    {
      id: 'fancy-number',
      labelKey: 'profile.membership.benefits.fancyNumber',
      values: {
        silver: 'none',
        gold: 'none',
        diamond: 'one-gift',
        super: 'one-premium-gift',
      },
    },
  ]);
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
