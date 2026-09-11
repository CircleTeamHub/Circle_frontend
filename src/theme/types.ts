export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  /** 置顶会话背景与次要文字，浅色下加强和普通会话的区分。 */
  pinnedSurface: string;
  pinnedTextSecondary: string;
  surfaceBorder: string;
  divider: string;
  primary: string;
  /** 强调图标的前景色；暗色提亮，浅色沿用 primary。 */
  iconAccent: string;
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
  /**
   * 链接 / 文字按钮色。亮色用 primaryDeep（白底 ≥ 5.9:1）；
   * 暗色用会员卡渐变的亮紫 #A86BF0（#6366F1 在 #1A1B23 上只有 ~3.8:1，不够 13px 小字用）。
   */
  link: string;
  text: string;
  textSecondary: string;
  white: string;
  black: string;
  online: string;
  error: string;
  /**
   * 危险操作的文字 / 图标色（弹窗菜单里的红字、顶部提醒的错误图标）。
   * 亮色不能直接用 error(#FF6B6B 在白底只有 2.9:1)，换更深的红保证 ≥4.5:1；
   * 暗色沿用 error —— 它在 surface 上有 6.5:1。
   */
  danger: string;
  /** 危险操作的实心按钮底色（配白字，4.7:1），两个主题同值。 */
  dangerFill: string;
  /** 比 surface 再低一级的柔和底：弹窗次要按钮、弹窗输入框底。 */
  surfaceMuted: string;
  /** 玻璃面（弹窗 / 顶部横幅）的边缘高光描边。 */
  glassBorder: string;
  /** 玻璃面之上的半透明按钮 / 输入框底：透一点玻璃本身，不用实心 surfaceMuted。 */
  glassButton: string;
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
