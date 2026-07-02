import type { Wallet } from '@/services/api/coin';
import { apiClient } from '@/services/api/client';

export type MembershipPlan = {
  level: number;
  name: string;
  price: number;
  // i18n key resolved at render via t(); backend may also send a display string,
  // which t() passes through unchanged for a missing key.
  perksKey: string;
};

export type MembershipUser = {
  id: string;
  vipLevel: number;
  creditScore: number;
};

export type UpgradeMembershipResponse = {
  user: MembershipUser;
  wallet: Wallet;
  plan: MembershipPlan;
};

export async function fetchMembershipPlans() {
  return apiClient<MembershipPlan[]>('/membership/plans');
}

export async function upgradeMembership(level: number) {
  return apiClient<UpgradeMembershipResponse>('/membership/upgrade', {
    method: 'POST',
    body: { level },
  });
}
