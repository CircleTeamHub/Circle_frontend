// 导入 React Navigation 的主题系统，用于给导航栏（header、tab bar 等）应用深色/浅色主题
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';        // 加载自定义字体
import { Stack } from 'expo-router';          // Expo Router 的 Stack 导航（页面栈）
import * as SplashScreen from 'expo-splash-screen'; // 控制启动屏（闪屏）的显示与隐藏
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar'; // 控制顶部状态栏样式（文字颜色等）
import 'react-native-reanimated';             // 必须在入口文件最早引入，启用动画引擎
import { rehydrateLanguageFromStorage } from '@/i18n';
import { migrateFromAsyncStorage } from '@/storage';
import { silenceDomBridgeRejection } from '@/utils/silence-dom-bridge-rejection';
import { useAuthStore } from '@/stores/authStore';
import { useChatPreferencesStore } from '@/features/chat/store/use-chat-preferences-store';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';

// 项目自定义主题系统：ThemeProvider 提供主题上下文，useTheme 读取当前主题
import { SessionBootstrap } from '@/components/app/session-bootstrap';
import { NotificationSnackbarHost } from '@/features/notifications/components/NotificationSnackbarHost';
import { ThemeProvider, useTheme } from '@/theme';

// 将 expo-router 内置的 ErrorBoundary 重新导出，使其在根路由层生效（捕获页面级报错）
export { ErrorBoundary } from 'expo-router';

// 阻止启动屏自动隐藏，等待字体加载完成后再手动隐藏
SplashScreen.preventAutoHideAsync();

// 过滤 Expo DOM 组件在导航卸载竞态时抛出的 injectJavaScript 拒绝（属于已知良性错误）
silenceDomBridgeRejection();

// RootStack：负责将项目主题与 React Navigation 主题桥接，并声明顶层路由结构
function RootStack() {
  const { colors, resolvedMode } = useTheme(); // 读取当前主题颜色和深/浅色模式

  // 将项目设计 token（colors）注入 React Navigation 的主题对象，
  // 使导航组件（header、背景等）与 App 主题保持一致
  const navTheme = {
    ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.background,   // card 即 header/tab bar 背景色
      border: colors.divider,
      primary: colors.primary,
      text: colors.text,
    },
  };

  return (
    <NavThemeProvider value={navTheme}>
      {/* 根据主题动态切换状态栏文字颜色（light = 白字 / dark = 黑字） */}
      <StatusBar style={colors.statusBarStyle === 'light' ? 'light' : 'dark'} />

      {/* Stack 导航：所有页面以"从右滑入"的动画叠加展示，全局隐藏 header */}
      <Stack
        screenOptions={{
          headerShown: false,                          // 所有页面不显示系统 header
          animation: 'slide_from_right',               // 页面切换动画：从右侧滑入
          contentStyle: { backgroundColor: colors.background },
          fullScreenGestureEnabled: false,             // 关闭全屏手势返回
          fullScreenGestureShadowEnabled: false,
          gestureEnabled: false,                       // 关闭滑动返回手势
        }}
      >
        {/* 四个顶层路由组，对应 app/(tabs)、(auth)、(chat)、(social) 目录 */}
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(chat)" />
        <Stack.Screen name="(social)" />
      </Stack>
    </NavThemeProvider>
  );
}

// RootLayout：应用真正的根组件
// 职责：迁移旧版 AsyncStorage 数据到 MMKV → 加载字体 → 隐藏启动屏 → 挂载主题 Provider → 渲染路由结构
export default function RootLayout() {
  // 加载自定义字体，loaded 为 true 时字体就绪，error 表示加载失败
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  /**
   * 旧版 AsyncStorage → MMKV 一次性数据迁移闸门。
   *
   * 迁移结束前 zustand store 已经用空 MMKV 同步完成了一次 hydration，
   * 因此迁移完成后需要让所有持久化 store 重新读取 MMKV，并刷新 i18n。
   * 主题在迁移完成后才挂载 ThemeProvider，初始 useState 即可读到迁移过的值。
   */
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    // 关键：rehydrate 必须无论迁移是否成功都执行 —— 不然单次 MMKV 写入失败会让
    // 启动屏永远不消失。storage.migrateFromAsyncStorage() 现在已经自己吞错，
    // 这里再额外 .catch() 兜一次保险，并通过 .finally 保证 setMigrated 始终触发。
    migrateFromAsyncStorage()
      .catch((err) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(
            '[startup] migration failed, continuing without migrated data',
            err,
          );
        }
      })
      .finally(() => {
        void useAuthStore.persist.rehydrate();
        void useChatPreferencesStore.persist.rehydrate();
        void useDiscoverFilterStore.persist.rehydrate();
        void useCircleNotificationStore.persist.rehydrate();
        rehydrateLanguageFromStorage();
        setMigrated(true);
      });
  }, []);

  // 字体加载出错时直接抛出，触发 ErrorBoundary 展示错误页
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // 字体和迁移都就绪后隐藏启动屏。dev 下 React 18 strict mode 会让 effect 跑两次，
  // 第二次 hideAsync 会被 expo-splash-screen 抛 "called multiple times" —— catch 掉。
  useEffect(() => {
    if (loaded && migrated) {
      SplashScreen.hideAsync().catch(() => {
        // 已经被隐藏；忽略即可。
      });
    }
  }, [loaded, migrated]);

  // 字体或迁移未就绪前不渲染任何内容（启动屏仍显示）
  if (!loaded || !migrated) return null;

  return (
    // ThemeProvider：提供全局主题上下文（颜色、深浅色模式等）
    <ThemeProvider>
      <SessionBootstrap />
      <RootStack />
      <NotificationSnackbarHost />
    </ThemeProvider>
  );
}
