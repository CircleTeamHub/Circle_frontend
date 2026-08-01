export type MembershipTier = 'silver' | 'gold' | 'diamond' | 'super';
export type MembershipLevel = 0 | 1 | 2 | 3 | 4;
export type MembershipEntitlementFloorLevel = 0 | 2;

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
  | 'permanent';

export type MembershipBenefit = {
  id: MembershipBenefitId;
  labelKey: `profile.membership.benefits.${string}`;
  values: Readonly<Record<MembershipTier, MembershipBenefitValue>>;
};

export const MEMBERSHIP_BENEFITS = [
  {
    id: 'group-member-limit',
    labelKey: 'profile.membership.benefits.groupMemberLimit',
    values: { silver: 200, gold: 400, diamond: 1000, super: 3000 },
  },
  {
    id: 'joined-groups',
    labelKey: 'profile.membership.benefits.joinedGroups',
    values: { silver: 100, gold: 100, diamond: 100, super: 100 },
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
  // 名字颜色、会员徽章是次要展示项，放到权益列表最下面。
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

export function resolveMembershipEntitlementLevel(
  vipLevel: number,
  entitlementFloorLevel: MembershipEntitlementFloorLevel,
): MembershipLevel {
  const actualLevel =
    Number.isInteger(vipLevel) && vipLevel > 0
      ? (Math.min(vipLevel, 4) as MembershipLevel)
      : 0;
  return Math.max(actualLevel, entitlementFloorLevel) as MembershipLevel;
}

/**
 * 发现页「城市筛选」可选城市数上限，映射自权益目录的 `city-filters`：
 * silver 2 / gold 10 / diamond 50 / super `'unlimited'`（无限）。
 * 非会员返回 0，与后端会员目录的 regular 档一致。
 * 调用方把 `'unlimited'` 视为不设上限（Infinity）。
 */
export function getCityFilterLimit(vipLevel: number): number | 'unlimited' {
  const tier = getMembershipTierForVipLevel(vipLevel);
  if (!tier) {
    return 0;
  }
  const benefit = MEMBERSHIP_BENEFITS.find((b) => b.id === 'city-filters');
  const value = benefit?.values[tier];
  if (value === 'unlimited') {
    return 'unlimited';
  }
  return typeof value === 'number' ? value : 0;
}
