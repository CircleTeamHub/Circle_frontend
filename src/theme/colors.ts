import type { ThemeColors } from './types';

/** 两个主题共用的靛蓝主色。浅色下强调图标直接沿用它。 */
const PRIMARY = '#6366F1';

/**
 * 暗色下的品牌紫强调色。brandPurple #7C5CF0 在背景 #1A1B23 上只有 3.79:1、
 * 在 surface #252630 上 3.32:1，都低于 4.5:1；提亮到同色系的 #B18AFF 后分别是
 * 6.49:1 / 5.68:1。
 *
 * tab 选中态（tabBarActive）与强调图标（iconAccent）必须是同一个值 —— 同一个
 * 「被点亮的紫」在一屏里出现两种深浅，用户只会当成渲染 bug。
 */
const DARK_ACCENT = '#B18AFF';

export const darkColors: ThemeColors = {
  background: '#1A1B23',
  surface: '#252630',
  pinnedSurface: '#252630',
  pinnedTextSecondary: '#FFFFFF',
  surfaceBorder: '#565A6B',
  switchOffTrack: '#565A6B',
  divider: '#3C3E4B',
  primary: PRIMARY,
  iconAccent: DARK_ACCENT,
  primaryLight: 'rgba(99, 102, 241, 0.25)',
  primaryDeep: '#4F46E5',
  // 会员卡渐变 ['#5B4BE6','#7C5CF0','#A86BF0'] 的核心色，app 的品牌紫
  brandPurple: '#7C5CF0',
  // tab 选中态与 iconAccent 同源（见 DARK_ACCENT）。
  tabBarActive: DARK_ACCENT,
  link: '#A86BF0',
  text: '#FFFFFF',
  // 暗色下次要文字一律纯白 —— 任何灰阶在 #1A1B23 上都糊。层级靠字号/字重区分,不靠明度。
  textSecondary: '#FFFFFF',
  white: '#FFFFFF',
  black: '#000000',
  online: '#22C55E',
  error: '#FF6B6B',
  success: '#22C55E',
  warning: '#FB8C00',
  orange: '#F97316',
  danger: '#FF6B6B',
  dangerFill: '#E5484D',
  surfaceMuted: '#30323E',
  glassBorder: 'rgba(255, 255, 255, 0.24)',
  glassButton: 'rgba(255, 255, 255, 0.10)',
  blue: '#3B82F6',
  purple: '#A855F7',
  deepPurple: '#8B5CF6',
  // 圈子加入门槛徽章（restriction-badge）：实心底 + 白字，两个主题同值。
  badgeVip: '#F59E0B',
  badgeCredit: '#3B82F6',
  badgeFancy: '#A855F7',
  sentBubble: '#6366F1',
  receivedBubble: '#252630',
  inputBg: '#252630',
  memberCardBg: '#D4A574',
  memberCardText: '#5C3D1A',
  memberTagBg: '#312E81',
  memberTagBgLight: 'rgba(49, 46, 129, 0.33)',
  vipBadgeBorder: '#A97524',
  vipBadgeAccent: '#F3C76C',
  vipBadgeRing: 'rgba(243, 199, 108, 0.35)',
  newUserBadgeBg: '#E5ECE7',
  newUserBadgeBorder: 'rgba(47, 109, 84, 0.55)',
  newUserBadgeAccent: '#2F6D54',
  newUserBadgeRing: 'rgba(47, 109, 84, 0.18)',
  sentTimeText: 'rgba(255, 255, 255, 0.8)',
  overlay: 'rgba(0, 0, 0, 0.4)',
  chatBackgroundScrim: 'rgba(26, 27, 35, 0.35)',
  statusBarStyle: 'light',
};

export const lightColors: ThemeColors = {
  background: '#F8F9FA',
  surface: '#FFFFFF',
  pinnedSurface: '#E8E8E8',
  pinnedTextSecondary: '#505050',
  surfaceBorder: '#E5E7EB',
  // iOS 关闭态会收缩 trackColor，轨道直接显示在白色滑块旁；#6B7280
  // 与白色滑块的对比度约为 4.83:1，避免浅色页面上再次融掉。
  switchOffTrack: '#6B7280',
  divider: '#F0F0F0',
  primary: PRIMARY,
  // 浅色底对比度本就够，强调图标不另开一支色。
  iconAccent: PRIMARY,
  primaryLight: 'rgba(99, 102, 241, 0.15)',
  primaryDeep: '#4F46E5',
  // 会员卡渐变 ['#5B4BE6','#7C5CF0','#A86BF0'] 的核心色，app 的品牌紫
  brandPurple: '#7C5CF0',
  // 浅色底（#FFFFFF）上 brandPurple 本身就有 4.52:1，直接沿用品牌紫。
  tabBarActive: '#7C5CF0',
  link: '#4F46E5',
  text: '#1A1B23',
  textSecondary: '#6B7280',
  white: '#FFFFFF',
  black: '#000000',
  online: '#22C55E',
  error: '#FF6B6B',
  success: '#22C55E',
  warning: '#FB8C00',
  orange: '#F97316',
  danger: '#E5484D',
  dangerFill: '#E5484D',
  surfaceMuted: '#F1F2F5',
  glassBorder: 'rgba(26, 27, 35, 0.10)',
  glassButton: 'rgba(26, 27, 35, 0.06)',
  blue: '#3B82F6',
  purple: '#A855F7',
  deepPurple: '#8B5CF6',
  // 圈子加入门槛徽章（restriction-badge）：实心底 + 白字，两个主题同值。
  badgeVip: '#F59E0B',
  badgeCredit: '#3B82F6',
  badgeFancy: '#A855F7',
  sentBubble: '#6366F1',
  receivedBubble: '#FFFFFF',
  inputBg: '#FFFFFF',
  memberCardBg: '#D4A574',
  memberCardText: '#5C3D1A',
  memberTagBg: '#312E81',
  memberTagBgLight: 'rgba(49, 46, 129, 0.33)',
  vipBadgeBorder: '#A97524',
  vipBadgeAccent: '#F3C76C',
  vipBadgeRing: 'rgba(243, 199, 108, 0.35)',
  newUserBadgeBg: '#E5ECE7',
  newUserBadgeBorder: 'rgba(47, 109, 84, 0.55)',
  newUserBadgeAccent: '#2F6D54',
  newUserBadgeRing: 'rgba(47, 109, 84, 0.18)',
  sentTimeText: 'rgba(255, 255, 255, 0.8)',
  overlay: 'rgba(0, 0, 0, 0.4)',
  chatBackgroundScrim: 'rgba(248, 249, 250, 0.35)',
  statusBarStyle: 'dark',
};
