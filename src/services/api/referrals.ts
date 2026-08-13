import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import {
  expectShape,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

export type ReferralStatus =
  | 'PENDING'
  | 'REWARDED'
  | 'CAPPED'
  | 'REJECTED'
  | 'EXPIRED';

export type ReferralItem = {
  id: string;
  status: ReferralStatus;
  inviterReward: number;
  inviteeReward: number;
  eligibleAt: string;
  expiresAt: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  invitee: { id: string; nickname: string };
};

export type MyReferrals = {
  inviteCode: string;
  rules: {
    enabled: boolean;
    inviterReward: number;
    inviteeReward: number;
    qualificationDays: number;
    expiryDays: number;
    monthlyCap: number;
  };
  summary: {
    total: number;
    pending: number;
    rewarded: number;
    capped: number;
    rejected: number;
    expired: number;
    pointsEarned: number;
  };
  items: ReferralItem[];
  nextCursor: string | null;
};

const REFERRAL_STATUSES = new Set<ReferralStatus>([
  'PENDING',
  'REWARDED',
  'CAPPED',
  'REJECTED',
  'EXPIRED',
]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isDateString(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isNullableDateString(value: unknown): value is string | null {
  return value === null || isDateString(value);
}

function isReferralItem(value: unknown): value is ReferralItem {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.status === 'string' &&
    REFERRAL_STATUSES.has(value.status as ReferralStatus) &&
    isPositiveInteger(value.inviterReward) &&
    isPositiveInteger(value.inviteeReward) &&
    isDateString(value.eligibleAt) &&
    isDateString(value.expiresAt) &&
    isNullableDateString(value.qualifiedAt) &&
    isNullableDateString(value.rewardedAt) &&
    (value.failureReason === null || typeof value.failureReason === 'string') &&
    isDateString(value.createdAt) &&
    isPlainObject(value.invitee) &&
    isNonEmptyString(value.invitee.id) &&
    isNonEmptyString(value.invitee.nickname)
  );
}

function isMyReferrals(value: unknown): value is MyReferrals {
  if (
    !isPlainObject(value) ||
    !isNonEmptyString(value.inviteCode) ||
    !isPlainObject(value.rules) ||
    typeof value.rules.enabled !== 'boolean' ||
    !isPositiveInteger(value.rules.inviterReward) ||
    !isPositiveInteger(value.rules.inviteeReward) ||
    !isPositiveInteger(value.rules.qualificationDays) ||
    !isPositiveInteger(value.rules.expiryDays) ||
    !isPositiveInteger(value.rules.monthlyCap) ||
    !isPlainObject(value.summary) ||
    !isNonNegativeInteger(value.summary.total) ||
    !isNonNegativeInteger(value.summary.pending) ||
    !isNonNegativeInteger(value.summary.rewarded) ||
    !isNonNegativeInteger(value.summary.capped) ||
    !isNonNegativeInteger(value.summary.rejected) ||
    !isNonNegativeInteger(value.summary.expired) ||
    !isNonNegativeInteger(value.summary.pointsEarned) ||
    !Array.isArray(value.items) ||
    !value.items.every(isReferralItem) ||
    !(value.nextCursor === null || isNonEmptyString(value.nextCursor))
  ) {
    return false;
  }
  return (
    value.summary.total ===
    value.summary.pending +
      value.summary.rewarded +
      value.summary.capped +
      value.summary.rejected +
      value.summary.expired
  );
}

export async function fetchMyReferrals(options?: {
  cursor?: string;
  limit?: number;
}): Promise<MyReferrals> {
  const params: string[] = [];
  if (options?.cursor) {
    params.push(`cursor=${encodeURIComponent(options.cursor)}`);
  }
  if (options?.limit !== undefined) {
    params.push(`limit=${encodeURIComponent(String(options.limit))}`);
  }
  const query = params.join('&');
  const raw = await apiClient<unknown>(
    `/referrals/me${query ? `?${query}` : ''}`,
  );
  return expectShape(
    raw,
    isMyReferrals,
    i18n.t('referral.errors.invalidData', {
      defaultValue: '邀请数据格式异常，请稍后重试',
    }),
  );
}
