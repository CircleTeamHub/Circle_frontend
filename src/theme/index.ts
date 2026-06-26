// Types
export type { ThemeMode, ResolvedMode, ThemeColors, ThemeContextValue } from './types';

// Color palettes
export { darkColors, lightColors } from './colors';

// Design tokens (theme-independent)
export { Spacing, Typography, Radius, Gradients } from './tokens';

// Provider + Hook
export { ThemeProvider, useTheme } from './provider';

// Note: an earlier `export const Colors = darkColors` legacy export was removed
// after grep confirmed no consumers in src/app. All components use `useTheme()`.
