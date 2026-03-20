import React, { createContext, useCallback, useEffect, useState } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors } from './colors';
import type { ThemeMode, ResolvedMode, ThemeContextValue } from './types';

const STORAGE_KEY = 'circle-im-theme-mode';

const ThemeContext = createContext<ThemeContextValue>({
  colors: darkColors,
  themeMode: 'system',
  resolvedMode: 'dark',
  setThemeMode: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate from storage
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeModeState(stored);
      }
      setHydrated(true);
    });
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const next = prev === 'dark' || (prev === 'system' && systemScheme === 'dark')
        ? 'light'
        : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, [systemScheme]);

  const resolvedMode: ResolvedMode =
    themeMode === 'system'
      ? (systemScheme ?? 'dark') === 'dark' ? 'dark' : 'light'
      : themeMode;

  const colors = resolvedMode === 'dark' ? darkColors : lightColors;

  const value: ThemeContextValue = {
    colors,
    themeMode,
    resolvedMode,
    setThemeMode,
    toggleTheme,
  };

  // Don't render until hydrated to avoid flash
  if (!hydrated) return null;

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}
