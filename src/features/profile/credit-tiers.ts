// 只保留阈值与档位「键」在代码里；所有可见文案走 i18n（credit.tier.* 等）。
export type CreditTierKey = "low" | "basic" | "good" | "excellent";

interface CreditTier {
  key: CreditTierKey;
  min: number;
}

interface CreditTierRange {
  min: number;
  max: number;
}

export const CREDIT_SCORE_MAX = 100;

// 从低到高；每档覆盖 [min, 下一档的 min)，最高档一直到满分（含）。
export const CREDIT_TIERS: readonly CreditTier[] = [
  { key: "low", min: 0 },
  { key: "basic", min: 60 },
  { key: "good", min: 75 },
  { key: "excellent", min: 90 },
];

export function clampCreditScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(CREDIT_SCORE_MAX, Math.floor(score)));
}

/** 分数所在档位的下标；入参应是 clampCreditScore 之后的分数。 */
export function getCreditTierIndex(score: number): number {
  let index = 0;
  CREDIT_TIERS.forEach((tier, tierIndex) => {
    if (score >= tier.min) index = tierIndex;
  });
  return index;
}

/** 档位在 0–满分 轴上的终点：下一档的起点，最高档为满分。进度条按它分段。 */
export function getCreditTierEnd(index: number): number {
  return CREDIT_TIERS[index + 1]?.min ?? CREDIT_SCORE_MAX;
}

/** 给用户看的分数区间（两端都含），如 60–74、90–100。 */
export function getCreditTierRange(index: number): CreditTierRange {
  const end = getCreditTierEnd(index);
  const isTopTier = index === CREDIT_TIERS.length - 1;
  return { min: CREDIT_TIERS[index].min, max: isTopTier ? end : end - 1 };
}
