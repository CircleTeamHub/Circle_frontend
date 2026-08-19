export interface PlazaRestrictions {
  vipLevel: number | null;
  creditScore: number | null;
  fancyNumber: boolean;
}

type Translate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/**
 * 把门槛拼成一句可读的条件。
 *
 * 返回空串是**正常**结果：后端可以因为一个前端当前隐藏的门槛（靓号）判定不可
 * 报名/不可查看，这时一条可展示的理由都没有。调用方必须处理空串，退回一句通用
 * 说明 —— 否则弹出来的是「报名需满足：」「需要 才能查看对方主页」这种半截话。
 */
export function buildRestrictionReasonText(
  restrictions: PlazaRestrictions,
  t: Translate,
  { showFancyNumber }: { showFancyNumber: boolean },
): string {
  const reasons: string[] = [];
  if (restrictions.vipLevel != null) {
    reasons.push(
      t('plaza.restriction.vipAtLeast', {
        level: restrictions.vipLevel,
        defaultValue: `VIP${restrictions.vipLevel}以上`,
      }),
    );
  }
  if (restrictions.creditScore != null) {
    reasons.push(
      t('plaza.restriction.creditAtLeast', {
        score: restrictions.creditScore,
        defaultValue: `信用值${restrictions.creditScore}以上`,
      }),
    );
  }
  if (showFancyNumber && restrictions.fancyNumber) {
    reasons.push(t('plaza.restriction.fancyNumber', { defaultValue: '靓号用户' }));
  }
  const separator = t('plaza.restriction.separator', { defaultValue: '、' });
  return reasons.join(separator);
}
