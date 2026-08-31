export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceBorder: string;
  divider: string;
  primary: string;
  primaryLight: string;
  /** 比 primary 深一档的靛蓝，用于需要更重的实心按钮/强调面 */
  primaryDeep: string;
  /** 品牌紫：会员卡渐变（Gradients.memberCard）的核心色，白字配它已在会员卡验证 */
  brandPurple: string;
  /**
   * 底部 tab 选中态的前景色（icon + 文字）。单独成 token 是因为它必须在
   * 各自主题的 bar 底色上读得清：暗色直接用 brandPurple 只有 3.3~3.8:1，
   * 达不到 9px 文字要求的 4.5:1，反而比纯白的未选中项更糊。
   */
  tabBarActive: string;
  text: string;
  textSecondary: string;
  white: string;
  black: string;
  online: string;
  error: string;
  success: string;
  warning: string;
  orange: string;
  blue: string;
  purple: string;
  deepPurple: string;
  /** 圈子加入门槛徽章（restriction-badge）实心底色。 */
  badgeVip: string;
  badgeCredit: string;
  badgeFancy: string;
  sentBubble: string;
  receivedBubble: string;
  inputBg: string;
  memberCardBg: string;
  memberCardText: string;
  memberTagBg: string;
  memberTagBgLight: string;
  vipBadgeBorder: string;
  vipBadgeAccent: string;
  vipBadgeRing: string;
  newUserBadgeBg: string;
  newUserBadgeBorder: string;
  newUserBadgeAccent: string;
  newUserBadgeRing: string;
  sentTimeText: string;
  overlay: string;
  statusBarStyle: 'light' | 'dark';
}

export interface ThemeContextValue {
  colors: ThemeColors;
  themeMode: ThemeMode;
  resolvedMode: ResolvedMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}
