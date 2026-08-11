import { apiClient } from '@/services/api/client';
import i18n from '@/i18n';
import {
  expectShape,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

/**
 * 客服类型。与后端 SupportAgentCategory 枚举一一对应。
 *
 * 前四类是「客服中心」的入口；membership 收编了原先独立的
 * EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID，会员中心的「联系客服」读它。
 */
export const SUPPORT_CATEGORY_IDS = [
  'recharge',
  'issue',
  'dispute',
  'account',
  'membership',
] as const;

export type SupportCategoryId = (typeof SUPPORT_CATEGORY_IDS)[number];

export type SupportAgent = {
  userID: string;
  nickname: string;
  avatarUrl: string | null;
  vipLevel: number;
};

export type SupportConfig = Record<SupportCategoryId, SupportAgent[]>;

function isSupportAgent(value: unknown): value is SupportAgent {
  if (!isPlainObject(value)) return false;

  return (
    isNonEmptyString(value.userID) &&
    isNonEmptyString(value.nickname) &&
    (value.avatarUrl === null || typeof value.avatarUrl === 'string') &&
    isFiniteNumber(value.vipLevel)
  );
}

function isSupportConfig(value: unknown): value is { agents: SupportConfig } {
  if (!isPlainObject(value) || !isPlainObject(value.agents)) return false;

  // 缺任何一类都当作无效响应:少一类会让对应入口静默变空态,
  // 和「后端确实没配」无法区分。
  return SUPPORT_CATEGORY_IDS.every((category) => {
    const list = (value.agents as Record<string, unknown>)[category];
    return Array.isArray(list) && list.every(isSupportAgent);
  });
}

export async function fetchSupportConfig(): Promise<SupportConfig> {
  const raw = await apiClient<unknown>('/support/config');
  const parsed = expectShape(
    raw,
    isSupportConfig,
    i18n.t('common.errors.invalidServerResponse', {
      defaultValue: '服务返回了无效数据',
    }),
  );
  return parsed.agents;
}
