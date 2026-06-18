export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceBorder: string;
  divider: string;
  primary: string;
  primaryLight: string;
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
