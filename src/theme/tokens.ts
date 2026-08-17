export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Typography = {
  title: { fontSize: 32, fontWeight: '700' as const },
  h1: { fontSize: 24, fontWeight: '700' as const },
  h2: { fontSize: 20, fontWeight: '700' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyRegular: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  small: { fontSize: 12, fontWeight: '400' as const },
  tiny: { fontSize: 10, fontWeight: '500' as const },
  tinyRegular: { fontSize: 11, fontWeight: '400' as const },
} as const;

export const Radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 26,
  full: 9999,
} as const;

export const Gradients = {
  // 默认封面/背景渐变（紫蓝对角：左下蓝 → 中部淡紫 → 右上紫粉）。
  // 用于朋友圈与圈子封面在用户未上传图片时的默认底图。
  defaultCover: ['#6E7BF0', '#CFC8F5', '#DBAAEF'] as const,
  // 会员卡渐变（左下深紫 → 中紫 → 右上亮紫），用于个人页「我的图标」卡片底。
  memberCard: ['#5B4BE6', '#7C5CF0', '#A86BF0'] as const,
} as const;

/**
 * 把 token 里的 #RRGGBB 派生成半透明版本（用于选中态淡底等）。
 * 只做透明度派生 —— 色相仍旧来自色板 token，不在组件里手写新颜色。
 * 非 #RRGGBB 输入（已是 rgba/命名色）原样返回，调用方不必分支。
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const value = parseInt(hex[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
