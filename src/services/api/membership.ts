import type { Wallet } from '@/services/api/coin';
import { apiClient } from '@/services/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import i18n from '@/i18n';
import {
  expectShape,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

// ---- 后端 wire 形状（GET /membership/plans，与 circle_be membership.service.ts 对齐）----
// 后端发的是 perks（显示串），不是 perksKey。屏幕不直接消费这个形状。
type MembershipPlanDTO = {
  level: number;
  name: string;
  price: number;
  perks: string;
};

export type MembershipPlan = {
  level: number;
  name: string;
  price: number;
  // perksKey 由 level 映射到本地 i18n key；defaultPerks 保留后端显示串，作为 t() 的
  // defaultValue —— 后端返回未映射 level 时回落后端文案，永不空白。
  perksKey: string;
  defaultPerks: string;
};

export type MembershipUser = {
  id: string;
  vipLevel: number;
  creditScore: number;
};

type UpgradeMembershipResponseDTO = {
  user: MembershipUser;
  wallet: Wallet;
  plan: MembershipPlanDTO;
};

export type UpgradeMembershipResponse = {
  user: MembershipUser;
  wallet: Wallet;
  plan: MembershipPlan;
};

// 本地静态配置 = 单一事实源：既是离线 / 请求失败时的兜底等级，也用来派生 level → key 映射。
export const FALLBACK_MEMBERSHIP_PLANS: MembershipPlan[] = [
  { level: 1, name: 'VIP1', price: 780, perksKey: 'profile.membership.tiers.vip1.perks', defaultPerks: '基础会员权益' },
  { level: 2, name: 'VIP2', price: 1280, perksKey: 'profile.membership.tiers.vip2.perks', defaultPerks: '更多群容量与基础折扣' },
  { level: 3, name: 'VIP3', price: 2100, perksKey: 'profile.membership.tiers.vip3.perks', defaultPerks: '高级身份标识与积分加成' },
  { level: 4, name: 'VIP4', price: 4600, perksKey: 'profile.membership.tiers.vip4.perks', defaultPerks: '专属靓号折扣与优先体验' },
  { level: 5, name: 'VIP5', price: 9100, perksKey: 'profile.membership.tiers.vip5.perks', defaultPerks: '至尊会员权益与最高折扣' },
];

const PLAN_PERKS_KEY: Record<number, string> = Object.fromEntries(
  FALLBACK_MEMBERSHIP_PLANS.map((plan) => [plan.level, plan.perksKey]),
);

function isMembershipPlanDTO(value: unknown): value is MembershipPlanDTO {
  return (
    isPlainObject(value) &&
    isFiniteNumber(value.level) &&
    isNonEmptyString(value.name) &&
    isFiniteNumber(value.price) &&
    typeof value.perks === 'string'
  );
}

function isMembershipPlanArray(value: unknown): value is MembershipPlanDTO[] {
  return Array.isArray(value) && value.every(isMembershipPlanDTO);
}

function toMembershipPlan(dto: MembershipPlanDTO): MembershipPlan {
  return {
    level: dto.level,
    name: dto.name,
    price: dto.price,
    perksKey: PLAN_PERKS_KEY[dto.level] ?? '',
    defaultPerks: dto.perks,
  };
}

export async function fetchMembershipPlans(): Promise<MembershipPlan[]> {
  const raw = await apiClient<unknown>('/membership/plans');
  const plans = expectShape(
    raw,
    isMembershipPlanArray,
    i18n.t('common.errors.invalidServerResponse', {
      defaultValue: '服务返回了无效数据',
    }),
  );
  return plans.map(toMembershipPlan);
}

export async function upgradeMembership(
  level: number,
): Promise<UpgradeMembershipResponse> {
  const raw = await apiClient<UpgradeMembershipResponseDTO>('/membership/upgrade', {
    method: 'POST',
    body: { level },
    // #91：与 coin 转账同款幂等头。响应丢失后的盲重试回放当前状态，不重复扣费
    //（后端 circle_be#120 起接受该头；旧后端忽略之，向后兼容）。
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  // 后端 upgrade 也回同构的 plan（perks 显示串）。映射后再交给上层保持类型诚实；
  // plan 缺失 / 异常时回落本地配置，避免读 undefined 崩掉整个升级流程。
  const plan = isMembershipPlanDTO(raw?.plan)
    ? toMembershipPlan(raw.plan)
    : FALLBACK_MEMBERSHIP_PLANS.find((item) => item.level === level) ??
      FALLBACK_MEMBERSHIP_PLANS[0];
  return { user: raw.user, wallet: raw.wallet, plan };
}
