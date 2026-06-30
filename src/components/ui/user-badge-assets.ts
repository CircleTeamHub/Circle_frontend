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

function readLevel(icon: Pick<DisplayIcon, 'title' | 'systemKey'>) {
  return Number(icon.title.match(/\d+/)?.[0] ?? icon.systemKey?.match(/\d+/)?.[0] ?? 1);
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
    const levelFromRecognition = getTopCollaboratorLevel(icon.recognitionCount);
    return levelFromRecognition ? TOP_COLLABORATOR_BADGE_ASSETS[levelFromRecognition] : null;
  }

  if (icon.systemKey === 'VERIFIED_PROFILE') {
    return VERIFIED_PROFILE_BADGE_ASSET;
  }

  if (icon.systemKey === 'CIRCLE_BUILDER') {
    return CIRCLE_BUILDER_BADGE_ASSET;
  }

  return null;
}
