const VIP_STAT_BACKGROUNDS = [
  'rgba(0, 0, 0, 0.42)',
  'rgba(0, 0, 0, 0.48)',
  'rgba(0, 0, 0, 0.54)',
  'rgba(0, 0, 0, 0.60)',
  'rgba(0, 0, 0, 0.66)',
  'rgba(0, 0, 0, 0.72)',
] as const;

const CREDIT_STAT_BACKGROUNDS = [
  { min: 90, color: 'rgba(255, 255, 255, 0.78)' },
  { min: 75, color: 'rgba(255, 255, 255, 0.72)' },
  { min: 60, color: 'rgba(255, 255, 255, 0.66)' },
  { min: 40, color: 'rgba(255, 255, 255, 0.60)' },
  { min: 1, color: 'rgba(255, 255, 255, 0.56)' },
  { min: Number.NEGATIVE_INFINITY, color: 'rgba(255, 255, 255, 0.52)' },
] as const;

const normalizeNumber = (value: number) => (Number.isFinite(value) ? value : 0);

export function getVipStatBackground(vipLevel: number): string {
  const level = Math.max(0, Math.floor(normalizeNumber(vipLevel)));
  const index = Math.min(level, VIP_STAT_BACKGROUNDS.length - 1);

  return VIP_STAT_BACKGROUNDS[index];
}

export function getCreditStatBackground(creditScore: number): string {
  const score = normalizeNumber(creditScore);

  return CREDIT_STAT_BACKGROUNDS.find((entry) => score >= entry.min)?.color ?? 'rgba(255, 255, 255, 0.52)';
}

export function getVipStatTextColor(): string {
  return '#FFFFFF';
}

export function getCreditStatTextColor(): string {
  return '#111827';
}
