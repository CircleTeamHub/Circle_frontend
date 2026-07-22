export type MembershipTier = 'silver' | 'gold' | 'diamond' | 'super';

export type MembershipDuration =
  | { type: 'months'; months: 1 | 6 | 12 }
  | { type: 'lifetime' };

export type MembershipPlan = {
  tier: MembershipTier;
  level: 1 | 2 | 3 | 4;
  nameKey: `profile.membership.tiers.${MembershipTier}.name`;
  duration: MembershipDuration;
  price: {
    currency: 'CNY';
    amount: number;
  };
  recommended: boolean;
};

export const MEMBERSHIP_PLANS = [
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
] as const satisfies readonly MembershipPlan[];

export type MembershipBenefitId =
  | 'name-color'
  | 'badge'
  | 'group-member-limit'
  | 'joined-groups'
  | 'note-storage'
  | 'city-filters'
  | 'fancy-number';

export type MembershipBenefitValue =
  | number
  | 'unlimited'
  | 'silver'
  | 'gold'
  | 'rainbow'
  | 'exclusive-shimmer'
  | 'diamond'
  | 'super-lifetime'
  | 'none'
  | 'one-gift'
  | 'one-premium-gift';

export type MembershipBenefit = {
  id: MembershipBenefitId;
  labelKey: `profile.membership.benefits.${string}`;
  values: Readonly<Record<MembershipTier, MembershipBenefitValue>>;
};

export const MEMBERSHIP_BENEFITS = [
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
    values: { silver: 200, gold: 400, diamond: 1000, super: 3000 },
  },
  {
    id: 'joined-groups',
    labelKey: 'profile.membership.benefits.joinedGroups',
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
      diamond: 'one-gift',
      super: 'one-premium-gift',
    },
  },
] as const satisfies readonly MembershipBenefit[];

export function getMembershipTierForVipLevel(
  vipLevel: number,
): MembershipTier | null {
  if (!Number.isInteger(vipLevel) || vipLevel <= 0) {
    return null;
  }

  if (vipLevel >= 4) {
    return 'super';
  }

  return MEMBERSHIP_PLANS[vipLevel - 1]?.tier ?? null;
}
