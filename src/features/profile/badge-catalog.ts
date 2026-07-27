import type { DisplayIcon, IconOption, SystemIconKey } from '@/types';
import type { MembershipTier } from '@/features/profile/membership-plans';

/**
 * 徽章说明的 i18n key 段（不直接返回文案，便于多语言）。
 * 文案在 myIcons.explain.<key>.description / .condition。
 */
export type IconExplanationKey =
  | 'empty'
  | 'circle'
  | 'vip'
  | 'newUser'
  | 'topCollaborator'
  | 'verifiedProfile'
  | 'circleBuilder'
  | 'systemDefault';

export function getSystemExplanationKey(
  systemKey: SystemIconKey | undefined,
): IconExplanationKey {
  switch (systemKey) {
    case 'VIP':
      return 'vip';
    case 'NEW_USER':
      return 'newUser';
    case 'TOP_COLLABORATOR':
      return 'topCollaborator';
    case 'VERIFIED_PROFILE':
      return 'verifiedProfile';
    case 'CIRCLE_BUILDER':
      return 'circleBuilder';
    default:
      return 'systemDefault';
  }
}

export function getOptionExplanationKey(
  option: Pick<IconOption, 'type' | 'systemKey'> | null,
): IconExplanationKey {
  if (!option) return 'empty';
  if (option.type === 'CIRCLE') return 'circle';
  return getSystemExplanationKey(option.systemKey);
}

/**
 * 徽章墙里的一枚徽章视图（拥有 / 未拥有统一形态）。
 * - owned=true 时 option 为后端返回的真实可选项，可加入资料展示位。
 * - owned=false（未拥有）时 option=null，只能查看介绍 / 获得方式。
 */
export type BadgeView = {
  key: string;
  explainKey: IconExplanationKey;
  title: string;
  previewIcon: DisplayIcon;
  option: IconOption | null;
  owned: boolean;
  /** 仅 VIP 徽章：当前档位（silver/gold/diamond/super），详情文案按档位区分。 */
  tierKey?: MembershipTier;
};

type SystemBadgeCatalogEntry = {
  systemKey: SystemIconKey;
  explainKey: IconExplanationKey;
  /** 未拥有时的本地化名称 key（myIcons.lockedName.*）。 */
  nameKey: string;
  /** 未拥有时喂给 UserIconBadge 的合成图标；systemVariant 决定 getSystemBadgeAsset 选图。 */
  lockedPreview: DisplayIcon;
};

function lockedPreview(
  systemKey: SystemIconKey,
  systemVariant: string,
  fallbackIconName: string,
): DisplayIcon {
  return {
    id: `locked:${systemKey}`,
    type: 'SYSTEM',
    title: systemVariant,
    imageUrl: null,
    fallbackIconName,
    systemKey,
    systemVariant,
    sortOrder: 0,
  };
}

/**
 * 系统徽章全量目录（前端静态，与后端 icon-badges 的 systemKey 一一对应）。
 * 后端 /icon/options 只返回已拥有的系统徽章；「未拥有」= 本目录 − 已拥有。
 * VIP / 合作达人是分级徽章：已拥有取最高档展示，这里的 lockedPreview 仅用于未拥有灰态。
 */
export const SYSTEM_BADGE_CATALOG: readonly SystemBadgeCatalogEntry[] = [
  {
    systemKey: 'VIP',
    explainKey: 'vip',
    nameKey: 'myIcons.lockedName.vip',
    lockedPreview: lockedPreview('VIP', 'VIP1', 'diamond'),
  },
  {
    systemKey: 'NEW_USER',
    explainKey: 'newUser',
    nameKey: 'myIcons.lockedName.newUser',
    lockedPreview: lockedPreview('NEW_USER', 'NEW_USER', 'rocket-outline'),
  },
  {
    systemKey: 'TOP_COLLABORATOR',
    explainKey: 'topCollaborator',
    nameKey: 'myIcons.lockedName.topCollaborator',
    lockedPreview: lockedPreview(
      'TOP_COLLABORATOR',
      'TOP_COLLABORATOR_1',
      'ribbon-outline',
    ),
  },
  {
    systemKey: 'VERIFIED_PROFILE',
    explainKey: 'verifiedProfile',
    nameKey: 'myIcons.lockedName.verifiedProfile',
    lockedPreview: lockedPreview(
      'VERIFIED_PROFILE',
      'VERIFIED_PROFILE',
      'shield-checkmark-outline',
    ),
  },
  {
    systemKey: 'CIRCLE_BUILDER',
    explainKey: 'circleBuilder',
    nameKey: 'myIcons.lockedName.circleBuilder',
    lockedPreview: lockedPreview(
      'CIRCLE_BUILDER',
      'CIRCLE_BUILDER',
      'construct-outline',
    ),
  },
];
