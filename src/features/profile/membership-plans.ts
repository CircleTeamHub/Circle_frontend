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
  | 'created-groups'
  | 'note-storage'
  | 'city-filters'
  | 'fancy-number'
  | 'premium-circle';

export type MembershipBenefitValue =
  | number
  | '999+'
  | 'unlimited'
  | 'silver'
  | 'gold'
  | 'rainbow'
  | 'exclusive-shimmer'
  | 'diamond'
  | 'super-lifetime'
  | 'none'
  | 'one-gift'
  | 'one-premium-gift'
  | 'silver-circle'
  | 'gold-circle'
  | 'diamond-circle'
  | 'super-member-circle';

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
    values: { silver: 300, gold: 500, diamond: 1000, super: 3000 },
  },
  {
    id: 'joined-groups',
    labelKey: 'profile.membership.benefits.joinedGroups',
    values: { silver: 200, gold: 500, diamond: '999+', super: 'unlimited' },
  },
  {
    id: 'created-groups',
    labelKey: 'profile.membership.benefits.createdGroups',
    values: { silver: 20, gold: 100, diamond: 300, super: 'unlimited' },
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
  {
    id: 'premium-circle',
    labelKey: 'profile.membership.benefits.premiumCircle',
    values: {
      silver: 'silver-circle',
      gold: 'gold-circle',
      diamond: 'diamond-circle',
      super: 'super-member-circle',
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
