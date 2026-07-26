/**
 * profile/support-categories.ts — 客服类型清单（单一事实来源）
 *
 * 「客服中心」列出多种客服类型，每种类型对应一个 OpenIM 客服账号。
 *
 * 测试期：每类的专属账号默认都回退到通用客服账号 SUPPORT_ACCOUNT_ID（默认 imAdmin），
 * 即所有类型进的是同一个会话——够用且能真实收发消息。
 *
 * 生产期：给每个类型各配一个专属客服账号（下列 EXPO_PUBLIC_SUPPORT_*_ID 环境变量），
 * 各类型就会自动拆成互相独立的会话，由不同客服接待，无需改代码。
 */
import { SUPPORT_ACCOUNT_ID } from '@/constants/config';

export type SupportCategoryId = 'recharge' | 'issue' | 'dispute' | 'account';

export interface SupportCategory {
  id: SupportCategoryId;
  /** Ionicons glyph 名；渲染处 cast 成 keyof typeof Ionicons.glyphMap。 */
  icon: string;
  labelKey: string;
  descriptionKey: string;
  /** 发起单聊的目标 OpenIM userID（原始 id，发起时由 im/client 的 toImUserId 去连字符）。 */
  accountId: string;
}

// 每类客服的专属账号：环境变量没配就回退到通用客服账号 SUPPORT_ACCOUNT_ID。
const resolveAccount = (raw: string | undefined): string =>
  raw?.trim() || SUPPORT_ACCOUNT_ID;

export const SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  {
    id: 'recharge',
    icon: 'card-outline',
    labelKey: 'profile.customerService.categories.recharge.label',
    descriptionKey: 'profile.customerService.categories.recharge.description',
    accountId: resolveAccount(process.env.EXPO_PUBLIC_SUPPORT_RECHARGE_ID),
  },
  {
    id: 'issue',
    icon: 'help-buoy-outline',
    labelKey: 'profile.customerService.categories.issue.label',
    descriptionKey: 'profile.customerService.categories.issue.description',
    accountId: resolveAccount(process.env.EXPO_PUBLIC_SUPPORT_ISSUE_ID),
  },
  {
    id: 'dispute',
    icon: 'shield-checkmark-outline',
    labelKey: 'profile.customerService.categories.dispute.label',
    descriptionKey: 'profile.customerService.categories.dispute.description',
    accountId: resolveAccount(process.env.EXPO_PUBLIC_SUPPORT_DISPUTE_ID),
  },
  {
    id: 'account',
    icon: 'person-circle-outline',
    labelKey: 'profile.customerService.categories.account.label',
    descriptionKey: 'profile.customerService.categories.account.description',
    // 注意：这里是「账号客服」类型的专属账号，别和通用 EXPO_PUBLIC_SUPPORT_ACCOUNT_ID 混淆。
    accountId: resolveAccount(process.env.EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID),
  },
];
