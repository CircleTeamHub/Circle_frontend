// Types
export type { ThemeMode, ResolvedMode, ThemeColors, ThemeContextValue } from './types';

// Color palettes
export { darkColors, lightColors } from './colors';

// Design tokens (theme-independent)
export { Spacing, Typography, Radius } from './tokens';

// Provider + Hook
export { ThemeProvider, useTheme } from './provider';

// Backward compatibility — static fallback for incremental migration
// Prefer `useTheme().colors` in components.
import { darkColors } from './colors';
export const Colors = darkColors;
