/**
 * profile/support-categories.ts — 客服类型清单（单一事实来源）
 *
 * 「客服中心」列出多种客服类型；点进一个类型后进入「客服头像页」，展示该类型下的
 * 客服账号（真实头像 + 会员头像框），用户点头像发起单聊。
 *
 * 一类可配多个客服：每类的环境变量支持**逗号分隔**多个 OpenIM 账号 ID，
 * 例如 EXPO_PUBLIC_SUPPORT_RECHARGE_ID="agentA,agentB"。头像页会逐个展示。
 *
 * 测试期：环境变量留空时回退到通用客服账号 SUPPORT_ACCOUNT_ID（默认 imAdmin），
 * 即每类都只有这一个客服、进的是同一个会话——够用且能真实收发消息。
 *
 * 生产期：给每个类型各配一个/多个专属客服账号（下列 EXPO_PUBLIC_SUPPORT_*_ID），
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
  /**
   * 该类型的客服账号列表（后端 UUID；历史配置里的 32 位十六进制 OpenIM ID 会被还原成 UUID）。
   * 一类可有多个客服，用户在客服头像页选择其一发起单聊。至少含一个（回退到通用客服账号）。
   */
  accountIds: string[];
}

/**
 * 历史配置里这些是 OpenIM userID —— 去了连字符的 32 位十六进制。
 * 自研栈的建单聊接口收的是后端 UUID(带连字符),而迁移把那一层转换删掉了:
 * 沿用旧值的部署里,四类客服都能正常渲染出来,但**一点就失败**。
 * 32 位十六进制是可无损还原的(它本来就是 UUID 去掉连字符),这里补回来;
 * 其它形态原样透传,由发布校验在打包前拦下。
 */
const LEGACY_OPENIM_ID = /^[0-9a-fA-F]{32}$/;

export function normalizeSupportAccountId(id: string): string {
  if (!LEGACY_OPENIM_ID.test(id)) return id;
  return [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20),
  ]
    .join('-')
    .toLowerCase();
}

// 解析单个环境变量为账号列表：支持逗号分隔配多个客服；去重、去空白。
// 全部留空则回退到通用客服账号 SUPPORT_ACCOUNT_ID，保证每类至少有一个可点开的客服。
const resolveAccounts = (raw: string | undefined): string[] => {
  const ids = (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map(normalizeSupportAccountId);
  const deduped = [...new Set(ids)];
  return deduped.length > 0 ? deduped : [normalizeSupportAccountId(SUPPORT_ACCOUNT_ID)];
};

export const SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  {
    id: 'recharge',
    icon: 'card-outline',
    labelKey: 'profile.customerService.categories.recharge.label',
    descriptionKey: 'profile.customerService.categories.recharge.description',
    accountIds: resolveAccounts(process.env.EXPO_PUBLIC_SUPPORT_RECHARGE_ID),
  },
  {
    id: 'issue',
    icon: 'help-buoy-outline',
    labelKey: 'profile.customerService.categories.issue.label',
    descriptionKey: 'profile.customerService.categories.issue.description',
    accountIds: resolveAccounts(process.env.EXPO_PUBLIC_SUPPORT_ISSUE_ID),
  },
  {
    id: 'dispute',
    icon: 'shield-checkmark-outline',
    labelKey: 'profile.customerService.categories.dispute.label',
    descriptionKey: 'profile.customerService.categories.dispute.description',
    accountIds: resolveAccounts(process.env.EXPO_PUBLIC_SUPPORT_DISPUTE_ID),
  },
  {
    id: 'account',
    icon: 'person-circle-outline',
    labelKey: 'profile.customerService.categories.account.label',
    descriptionKey: 'profile.customerService.categories.account.description',
    // 注意：这里是「账号客服」类型的专属账号，别和通用 EXPO_PUBLIC_SUPPORT_ACCOUNT_ID 混淆。
    accountIds: resolveAccounts(process.env.EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID),
  },
];

export function getSupportCategory(
  id: string | undefined,
): SupportCategory | undefined {
  return SUPPORT_CATEGORIES.find((category) => category.id === id);
}
