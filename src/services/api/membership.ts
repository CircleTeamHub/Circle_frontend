import { apiClient } from '@/services/api/client';
import i18n from '@/i18n';
import {
  expectShape,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

export type MembershipTierKey = 'silver' | 'gold' | 'diamond' | 'super';

export type MembershipPlan = {
  level: 1 | 2 | 3 | 4;
  key: MembershipTierKey;
  durationMonths: number | null;
  lifetime: boolean;
  priceCny: number;
  recommended: boolean;
};

export type MembershipProgramStatus = {
  enabled: boolean;
  enabledAt: string | null;
  entitlementFloorLevel: 0 | 2;
};

const MEMBERSHIP_KEYS = new Set<MembershipTierKey>([
  'silver',
  'gold',
  'diamond',
  'super',
]);

function isMembershipPlan(value: unknown): value is MembershipPlan {
  if (!isPlainObject(value)) return false;

  return (
    isFiniteNumber(value.level) &&
    Number.isInteger(value.level) &&
    value.level >= 1 &&
    value.level <= 4 &&
    isNonEmptyString(value.key) &&
    MEMBERSHIP_KEYS.has(value.key as MembershipTierKey) &&
    (value.durationMonths === null || isFiniteNumber(value.durationMonths)) &&
    typeof value.lifetime === 'boolean' &&
    isFiniteNumber(value.priceCny) &&
    typeof value.recommended === 'boolean'
  );
}

function isMembershipPlanArray(value: unknown): value is MembershipPlan[] {
  return Array.isArray(value) && value.every(isMembershipPlan);
}

function isMembershipProgramStatus(
  value: unknown,
): value is MembershipProgramStatus {
  if (!isPlainObject(value)) return false;

  return (
    typeof value.enabled === 'boolean' &&
    (value.enabledAt === null || isNonEmptyString(value.enabledAt)) &&
    (value.entitlementFloorLevel === 0 || value.entitlementFloorLevel === 2)
  );
}

export async function fetchMembershipPlans(): Promise<MembershipPlan[]> {
  const raw = await apiClient<unknown>('/membership/plans');
  return expectShape(
    raw,
    isMembershipPlanArray,
    i18n.t('common.errors.invalidServerResponse', {
      defaultValue: '服务返回了无效数据',
    }),
  );
}

export async function fetchMembershipProgramStatus(): Promise<MembershipProgramStatus> {
  const raw = await apiClient<unknown>('/membership/program');
  return expectShape(
    raw,
    isMembershipProgramStatus,
    i18n.t('common.errors.invalidServerResponse', {
      defaultValue: '服务返回了无效数据',
    }),
  );
}
