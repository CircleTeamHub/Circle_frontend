/**
 * profile/support-categories.ts — 客服类型的展示元数据（单一事实来源）
 *
 * 「客服中心」列出多种客服类型；点进一个类型后进入「客服头像页」，展示该类型下的
 * 客服账号（真实头像 + 会员头像框），用户点头像发起单聊。
 *
 * 这里**只有展示元数据**。客服账号本身由后端下发（GET /support/config →
 * supportConfigStore），管理台维护，换客服不需要重新出包发版。历史上账号是
 * EXPO_PUBLIC_SUPPORT_*_ID 编译期常量，未配置时回退到自研聊天栈里并不存在的
 * imAdmin —— 入口渲染正常、一点就被后端以「用户不存在」拒绝。
 */
import type { SupportCategoryId } from '@/services/api/support';

export interface SupportCategory {
  id: SupportCategoryId;
  /** Ionicons glyph 名；渲染处 cast 成 keyof typeof Ionicons.glyphMap。 */
  icon: string;
  labelKey: string;
  descriptionKey: string;
}

/**
 * 客服中心列出的类型。membership 不在其中：它是会员中心「联系客服」的专属类型，
 * 由 MemberCenterScreen 直接从 store 取，不作为客服中心的一个入口。
 */
export const SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  {
    id: 'recharge',
    icon: 'card-outline',
    labelKey: 'profile.customerService.categories.recharge.label',
    descriptionKey: 'profile.customerService.categories.recharge.description',
  },
  {
    id: 'issue',
    icon: 'help-buoy-outline',
    labelKey: 'profile.customerService.categories.issue.label',
    descriptionKey: 'profile.customerService.categories.issue.description',
  },
  {
    id: 'dispute',
    icon: 'shield-checkmark-outline',
    labelKey: 'profile.customerService.categories.dispute.label',
    descriptionKey: 'profile.customerService.categories.dispute.description',
  },
  {
    id: 'account',
    icon: 'person-circle-outline',
    labelKey: 'profile.customerService.categories.account.label',
    descriptionKey: 'profile.customerService.categories.account.description',
  },
];

export function getSupportCategory(
  id: string | undefined,
): SupportCategory | undefined {
  return SUPPORT_CATEGORIES.find((category) => category.id === id);
}

export type { SupportCategoryId };
