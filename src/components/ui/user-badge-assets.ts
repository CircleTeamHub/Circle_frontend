import type { DisplayIcon } from '@/types';

const VIP_BADGE_ASSETS = {
  1: require('../../../assets/badges/vip1.png'),
  2: require('../../../assets/badges/vip2.png'),
  3: require('../../../assets/badges/vip3.png'),
  4: require('../../../assets/badges/vip4.png'),
  5: require('../../../assets/badges/vip5.png'),
} as const;

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

export function getSystemBadgeVisualScale(icon: DisplayIcon) {
  if (icon.systemKey === 'TOP_COLLABORATOR') {
    return 1.04;
  }

  if (icon.systemKey === 'NEW_USER' || icon.systemKey === 'CIRCLE_BUILDER') {
    return 1.16;
  }

  if (icon.systemKey === 'VIP') {
    return clampLevel(readLevel(icon), 5) === 5 ? 1 : 1.16;
  }

  return 1;
}
