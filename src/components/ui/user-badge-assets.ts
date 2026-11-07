import type { DisplayIcon } from '@/types';

const VIP_BADGE_ASSETS = {
  1: require('../../../assets/badges/vip1.png'),
  2: require('../../../assets/badges/vip2.png'),
  3: require('../../../assets/badges/vip3.png'),
  4: require('../../../assets/badges/vip4.png'),
  5: require('../../../assets/badges/vip5.png'),
} as const;

// 超级会员专属徽章:与会员中心档位奖章同一张橙色皇冠(assets/badges/super.png)。
// 超级档不用分级盾徽,凡 vipLevel 映射到 super 的都换这张。
const SUPER_BADGE_ASSET = require('../../../assets/badges/super.png');

const TOP_COLLABORATOR_BADGE_ASSETS = {
  1: require('../../../assets/badges/good1.png'),
  2: require('../../../assets/badges/good2.png'),
  3: require('../../../assets/badges/good3.png'),
} as const;

const NEW_JOINER_BADGE_ASSET = require('../../../assets/badges/newjoiner.png');
const VERIFIED_PROFILE_BADGE_ASSET = require('../../../assets/badges/verifie.png');
const CIRCLE_BUILDER_BADGE_ASSET = require('../../../assets/badges/builder.png');

type BadgeLevel = 1 | 2 | 3 | 4 | 5;
type CollaboratorLevel = 1 | 2 | 3;

function clampLevel(value: number | null, max: number) {
  if (!value || value < 1) return 1;
  return Math.min(value, max);
}

function readLevel(icon: Pick<DisplayIcon, 'title' | 'systemKey' | 'systemVariant'>) {
  return Number(
    icon.title.match(/\d+/)?.[0] ??
      icon.systemVariant?.match(/\d+/)?.[0] ??
      icon.systemKey?.match(/\d+/)?.[0] ??
      1,
  );
}

export function getTopCollaboratorLevel(
  recognitionCount: number | null | undefined,
): CollaboratorLevel | null {
  if (typeof recognitionCount !== 'number' || !Number.isFinite(recognitionCount)) return null;
  if (recognitionCount >= 10000) return 3;
  if (recognitionCount >= 1000) return 2;
  if (recognitionCount >= 100) return 1;
  return null;
}

export function getSystemBadgeAsset(icon: DisplayIcon) {
  if (icon.systemKey === 'VIP') {
    const level = clampLevel(readLevel(icon), 5) as BadgeLevel;
    // 镜像 membership-plans 的 vipLevel→档位(1银 2金 3钻 ≥4超级)。内联而非 import,
    // 保持本模块只依赖 png+类型(测试用 VM 加载,禁止非 png import)。
    if (level >= 4) {
      return SUPER_BADGE_ASSET; // 超级 = 橙色皇冠
    }
    if (level === 3) {
      return VIP_BADGE_ASSETS[5]; // 钻石 = 真钻石徽章(vip5,而非 level 对应的 vip3 银徽)
    }
    return VIP_BADGE_ASSETS[level];
  }

  if (icon.systemKey === 'NEW_USER') {
    return NEW_JOINER_BADGE_ASSET;
  }

  if (icon.systemKey === 'TOP_COLLABORATOR') {
    const levelFromVariant = Number(icon.systemVariant?.match(/\d+$/)?.[0] ?? 0);
    // 契约：getTopCollaboratorLevel 无档位时必须返回 null（不是 0），?? 才会回退到
    // variant。若它改成返回 0，`0 ?? x` 会短路成 0 使 variant 回退静默失效——改动需谨慎。
    const levelFromRecognition = getTopCollaboratorLevel(icon.recognitionCount);
    const level =
      levelFromRecognition ?? ([1, 2, 3].includes(levelFromVariant) ? levelFromVariant : null);
    return level ? TOP_COLLABORATOR_BADGE_ASSETS[level as CollaboratorLevel] : null;
  }

  if (icon.systemKey === 'VERIFIED_PROFILE') {
    return VERIFIED_PROFILE_BADGE_ASSET;
  }

  if (icon.systemKey === 'CIRCLE_BUILDER') {
    return CIRCLE_BUILDER_BADGE_ASSET;
  }

  return null;
}

/** 一张系统徽章素材里可见画面的大小与位置,都按画布长边归一。 */
export interface SystemBadgeArtBox {
  /** 可见部分(alpha > 16 的包围盒)长边 / 画布长边。 */
  visibleRatio: number;
  /** 可见部分中心相对画布中心的偏移(正 = 偏右 / 偏下)。 */
  offsetX: number;
  offsetY: number;
}

/**
 * 每张系统徽章素材的可见画面(实测)。素材四周留的透明边各不相同、画面也不一定在正中:
 * 按画布等大渲染时,竖版素材比圆形圈子徽章小一圈、高低也对不齐。UserIconBadge 据此把
 * 画面挪回中心、放大到和同档圆形徽章一样大。
 * 换素材要同步改这里;test/user-badge-assets.test.js 会直接量 PNG 核对。
 */
const VIP_ART: SystemBadgeArtBox = { visibleRatio: 0.73, offsetX: 0, offsetY: -0.035 };
const SYSTEM_BADGE_ART = new Map<unknown, SystemBadgeArtBox>([
  [VIP_BADGE_ASSETS[1], VIP_ART],
  [VIP_BADGE_ASSETS[2], VIP_ART],
  [VIP_BADGE_ASSETS[3], VIP_ART],
  [VIP_BADGE_ASSETS[4], { visibleRatio: 0.73, offsetX: 0, offsetY: -0.037 }],
  [VIP_BADGE_ASSETS[5], { visibleRatio: 0.76, offsetX: 0.023, offsetY: -0.057 }],
  [SUPER_BADGE_ASSET, { visibleRatio: 0.93, offsetX: 0.002, offsetY: 0.034 }],
  [TOP_COLLABORATOR_BADGE_ASSETS[1], { visibleRatio: 0.78, offsetX: 0, offsetY: -0.022 }],
  [TOP_COLLABORATOR_BADGE_ASSETS[2], { visibleRatio: 0.78, offsetX: 0, offsetY: -0.022 }],
  [TOP_COLLABORATOR_BADGE_ASSETS[3], { visibleRatio: 0.78, offsetX: 0, offsetY: -0.022 }],
  [NEW_JOINER_BADGE_ASSET, { visibleRatio: 0.73, offsetX: 0, offsetY: -0.034 }],
  [VERIFIED_PROFILE_BADGE_ASSET, { visibleRatio: 0.8, offsetX: 0, offsetY: -0.084 }],
  [CIRCLE_BUILDER_BADGE_ASSET, { visibleRatio: 0.73, offsetX: 0, offsetY: -0.034 }],
]);

const FULL_CANVAS_ART: SystemBadgeArtBox = { visibleRatio: 1, offsetX: 0, offsetY: 0 };

export function getSystemBadgeArtBox(icon: DisplayIcon): SystemBadgeArtBox {
  const asset = getSystemBadgeAsset(icon);
  return (asset && SYSTEM_BADGE_ART.get(asset)) ?? FULL_CANVAS_ART;
}
