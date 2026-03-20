import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { ThemeProvider, useTheme } from '@/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { colors, resolvedMode } = useTheme();

  const navTheme = {
    ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.background,
      border: colors.divider,
      primary: colors.primary,
      text: colors.text,
    },
  };

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={colors.statusBarStyle === 'light' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(chat)" />
        <Stack.Screen name="(social)" />
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return (
    <ThemeProvider>
      <RootStack />
    </ThemeProvider>
  );
}
