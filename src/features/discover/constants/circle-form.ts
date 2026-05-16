// 表单常量 —— Create + Edit 圈子流程共享。i18n key 由各自 useMemo 包起来（依赖 t）。
export const CIRCLE_PRESET_CATEGORY_KEYS = [
  'life',
  'food',
  'sports',
  'social',
  'gaming',
  'photography',
  'work',
  'trade',
] as const;

export const CIRCLE_VIP_OPTIONS_VALUES = [null, 1, 2, 3, 5] as const;
export const CIRCLE_CREDIT_OPTIONS_VALUES = [null, 60, 70, 80, 90] as const;

export type CircleVipOption = (typeof CIRCLE_VIP_OPTIONS_VALUES)[number];
export type CircleCreditOption = (typeof CIRCLE_CREDIT_OPTIONS_VALUES)[number];

export const CIRCLE_MAX_TAGS = 3;
