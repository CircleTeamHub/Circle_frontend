import { apiClient } from '@/services/api/client';
import { allowPeerMediaUrl } from '@/services/api/utils';
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
  /** 归一化后的昵称;后端没给(null/空串)时为 `''`,由屏幕回落到通用客服名。 */
  nickname: string;
  /** 已过对端媒体白名单;不可信的外部地址在这里就变成 null。 */
  avatarUrl: string | null;
  vipLevel: number;
};

export type SupportConfig = Record<SupportCategoryId, SupportAgent[]>;

/** 后端原样下发的客服条目：昵称、头像都按用户资料的宽松形状收。 */
type RawSupportAgent = {
  userID: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  vipLevel: number;
};

/**
 * 只有 userID / vipLevel 是硬性要求。
 *
 * 昵称按 `PublicUser.nickname`(string | null)收:客服仍是普通用户,历史账号或
 * 没填昵称的账号都可能是 null。之前这里要求非空字符串,一个这样的账号会让
 * 整份 `/support/config` 判为无效响应 —— 五类客服全线不可用,只因为某个人没起名。
 * 屏幕侧本来就备了「在线客服 / 在线客服 N」的回退文案。
 */
function isRawSupportAgent(value: unknown): value is RawSupportAgent {
  if (!isPlainObject(value)) return false;

  return (
    isNonEmptyString(value.userID) &&
    (value.nickname == null || typeof value.nickname === 'string') &&
    (value.avatarUrl == null || typeof value.avatarUrl === 'string') &&
    isFiniteNumber(value.vipLevel)
  );
}

function isRawSupportConfig(
  value: unknown,
): value is { agents: Record<SupportCategoryId, RawSupportAgent[]> } {
  if (!isPlainObject(value) || !isPlainObject(value.agents)) return false;

  // 缺任何一类都当作无效响应:少一类会让对应入口静默变空态,
  // 和「后端确实没配」无法区分。
  return SUPPORT_CATEGORY_IDS.every((category) => {
    const list = (value.agents as Record<string, unknown>)[category];
    return Array.isArray(list) && list.every(isRawSupportAgent);
  });
}

/**
 * 归一化成屏幕直接可用的形状。
 *
 * 头像必须过 `allowPeerMediaUrl`:客服账号的 `avatarUrl` 就是普通用户资料字段,
 * 管理台把它指向任意外部主机后,每个打开客服列表的人都会静默向那台机器发一次
 * GET —— 泄露 IP 与访问时刻。不在白名单里就退化成 null,列表渲染耳麦徽章。
 */
function toSupportAgent(raw: RawSupportAgent): SupportAgent {
  return {
    userID: raw.userID,
    nickname: typeof raw.nickname === 'string' ? raw.nickname.trim() : '',
    avatarUrl: allowPeerMediaUrl(raw.avatarUrl),
    vipLevel: raw.vipLevel,
  };
}

export async function fetchSupportConfig(): Promise<SupportConfig> {
  const raw = await apiClient<unknown>('/support/config');
  const parsed = expectShape(
    raw,
    isRawSupportConfig,
    i18n.t('common.errors.invalidServerResponse', {
      defaultValue: '服务返回了无效数据',
    }),
  );

  return Object.fromEntries(
    SUPPORT_CATEGORY_IDS.map((category) => [
      category,
      parsed.agents[category].map(toSupportAgent),
    ]),
  ) as SupportConfig;
}
