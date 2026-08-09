// 导入 React Navigation 的主题系统，用于给导航栏（header、tab bar 等）应用深色/浅色主题
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';        // 加载自定义字体
import { Redirect, Stack, useSegments } from 'expo-router';          // Expo Router 的 Stack 导航（页面栈）
import * as SplashScreen from 'expo-splash-screen'; // 控制启动屏（闪屏）的显示与隐藏
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar'; // 控制顶部状态栏样式（文字颜色等）
// 必须在入口文件最早引入，启用动画引擎（具名导入同样会执行其原生初始化副作用）
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ActivityIndicator, NativeModules, View } from 'react-native';
import { rehydrateLanguageFromStorage } from '@/i18n';
import { initEncryptedStorage, migrateFromAsyncStorage } from '@/storage';
import { excludeMmkvDirFromIOSBackup } from '@/storage/ios-backup-exclusion';
import { silenceDomBridgeRejection } from '@/utils/silence-dom-bridge-rejection';
import { ensureLiveKitGlobals } from '@/utils/livekit-globals';
import { useAuthStore } from '@/stores/authStore';
import { useKnownAccountsStore } from '@/stores/knownAccountsStore';
import { useChatPreferencesStore } from '@/features/chat/store/use-chat-preferences-store';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';

// 项目自定义主题系统：ThemeProvider 提供主题上下文，useTheme 读取当前主题
import { getAuthRouteDecision } from '@/components/app/auth-route-policy';
import { LaunchReveal } from '@/components/app/launch-reveal';
import { LoginSecurityCodeGate } from '@/components/app/login-security-code-gate';
import { SessionBootstrap } from '@/components/app/session-bootstrap';
import { MemberNameAnimationProvider } from '@/components/ui/member-name-animation';
import { AccountSwitcherSheet } from '@/features/profile/components/account-switcher-sheet';
import { NotificationSnackbarHost } from '@/features/notifications/components/NotificationSnackbarHost';
import { PushNotificationRouteHandler } from '@/features/notifications/components/PushNotificationRouteHandler';
import { PushNotificationTokenRegistrar } from '@/features/notifications/components/PushNotificationTokenRegistrar';
import { CallInviteHost } from '@/features/call/components/CallInviteHost';
import { ThemeProvider, useTheme } from '@/theme';
import {
  initSentry,
  wrapWithSentry,
  captureSentryTestError,
} from '@/observability/sentry';

// 将 expo-router 内置的 ErrorBoundary 重新导出，使其在根路由层生效（捕获页面级报错）
export { ErrorBoundary } from 'expo-router';

// 崩溃/错误上报：仅当配置了 DSN（EXPO_PUBLIC_SENTRY_DSN 或 app.json extra.sentryDsn）
// 时才真正初始化，否则为完全 no-op。尽早调用以捕获启动期错误。
initSentry();

// 临时验证钩子：在 .env.local 设 EXPO_PUBLIC_SENTRY_TEST=1 并重建 App，启动时会发一
// 条测试错误到 Sentry，用来确认前端崩溃捕获生效。验证后删掉该 flag（或这几行）即可。
if (__DEV__ && process.env.EXPO_PUBLIC_SENTRY_TEST === '1') {
  captureSentryTestError();
}

type PersistedStore = {
  persist?: {
    rehydrate?: () => unknown;
  };
};

// 阻止启动屏自动隐藏，等待字体加载完成后再手动隐藏
SplashScreen.preventAutoHideAsync();

// 过滤 Expo DOM 组件在导航卸载竞态时抛出的 injectJavaScript 拒绝（属于已知良性错误）
silenceDomBridgeRejection();

async function registerLiveKitGlobals() {
  if (!NativeModules.WebRTCModule) {
    return;
  }

  try {
    const { registerGlobals } = await import('@livekit/react-native');
    ensureLiveKitGlobals(registerGlobals);
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[startup] LiveKit globals unavailable', error);
    }
  }
}

void registerLiveKitGlobals();

async function rehydratePersistedStore(name: string, store: PersistedStore) {
  const rehydrate = store.persist?.rehydrate;
  if (typeof rehydrate !== 'function') {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[startup] ${name} store persist API unavailable; skipping rehydrate`);
    }
    return;
  }

  try {
    await Promise.resolve(rehydrate());
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[startup] ${name} store rehydrate failed`, error);
    }
  }
}

/**
 * 启动引导（AsyncStorage→MMKV 迁移 + 各持久化 store 一次性水合 + i18n）用模块级
 * promise 记忆化，确保**只执行一次**：dev StrictMode 会重复挂载根布局、effect 也可能
 * 因重挂再次触发，若每次都 rehydrate，迟到的水合会和登录/注册写入抢跑、用旧持久化覆盖
 * 内存里的新会话（此前 onboarding 被弹回的放大器）。复用同一个 promise 后，无论触发几次
 * 都只真正水合一次。
 */
let startupBootstrapPromise: Promise<void> | null = null;
function ensureStartupBootstrap(): Promise<void> {
  startupBootstrapPromise ??= (async () => {
    try {
      // FE#87：先建好加密 MMKV（密钥在 SecureStore），storage 壳才可用；
      // AsyncStorage 迁移与所有 zustand 水合都在它之后。
      await initEncryptedStorage();
      await migrateFromAsyncStorage();
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[startup] migration failed, continuing without migrated data',
          err,
        );
      }
    }
    await Promise.all([
      rehydratePersistedStore('auth', useAuthStore),
      rehydratePersistedStore('known accounts', useKnownAccountsStore),
      rehydratePersistedStore('chat preferences', useChatPreferencesStore),
      rehydratePersistedStore('discover filter', useDiscoverFilterStore),
      rehydratePersistedStore('circle notification', useCircleNotificationStore),
    ]);
    rehydrateLanguageFromStorage();
    // 尽力而为，不 await：MMKV 目录的 iOS 备份排除（#88），失败不影响启动。
    void excludeMmkvDirFromIOSBackup();
  })();
  return startupBootstrapPromise;
}

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
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(chat)" />
        <Stack.Screen name="(social)" />
      </Stack>
    </NavThemeProvider>
  );
}

function AuthRouteGuard({ children }: { children: ReactNode }) {
  const segments = useSegments();
  const firstSegment = segments[0];
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const { colors } = useTheme();
  const decision = getAuthRouteDecision({
    firstSegment,
    isAuthenticated,
    isLoading,
    onboardingRequired,
  });

  if (decision.type === 'redirect') {
    // 关键：重定向时必须保持导航器（children 里的 <Stack>）挂载。
    // expo-router 的 <Redirect> 靠 router.replace 生效，而 router 需要一个已挂载的
    // 导航器；若只返回 <Redirect>、把 <Stack> 卸载，replace 无处落地、segment 永不
    // 更新，getAuthRouteDecision 便持续判定 redirect → 无限重定向（"Maximum update
    // depth exceeded"）。并存渲染让导航栈常驻、重定向一次即收敛。
    return (
      <>
        {children}
        <Redirect href={decision.href} />
      </>
    );
  }

  if (decision.type === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return children;
}

// RootLayout：应用真正的根组件
// 职责：迁移旧版 AsyncStorage 数据到 MMKV → 加载字体 → 隐藏启动屏 → 挂载主题 Provider → 渲染路由结构
function RootLayout() {
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
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);
  const [launchRevealDone, setLaunchRevealDone] = useState(false);
  useEffect(() => {
    let cancelled = false;

    // 引导逻辑搬到模块级 ensureStartupBootstrap()（记忆化 → 只跑一次）；
    // 这里只负责在它完成后解除启动闸门。无论迁移成功与否，bootstrap 内部都会
    // 继续 rehydrate，保证启动屏不会永远卡住。
    ensureStartupBootstrap().finally(() => {
      if (!cancelled) {
        setMigrated(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 字体加载出错时直接抛出，触发 ErrorBoundary 展示错误页
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // 字体和迁移都就绪后隐藏系统启动屏，再播放 React Native 层的入场动画。
  useEffect(() => {
    if (!loaded || !migrated || nativeSplashHidden) {
      return;
    }

    let cancelled = false;
    SplashScreen.hideAsync()
      .catch(() => {
        // 已经被隐藏；忽略即可。
      })
      .finally(() => {
        if (!cancelled) {
          setNativeSplashHidden(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loaded, migrated, nativeSplashHidden]);

  // App「从中心弹性展开」：开场序列冲镜揭幕时，把整个 UI 从略缩放 spring 弹到 1。
  // 幕布覆盖期间 UI 一直是 0.92（藏在遮罩后不可见），揭幕瞬间带回弹地放大 = 弹性展开。
  const appScale = useSharedValue(0.92);
  const appScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: appScale.value }],
  }));
  const springAppOpen = useCallback(() => {
    appScale.value = withSpring(1, { damping: 11, stiffness: 150, mass: 0.7 });
  }, [appScale]);

  const handleLaunchRevealFinish = useCallback(() => {
    // 兜底：即使 onReveal 未触发，序列结束也确保 UI 回到 1（避免卡在 0.92）。
    springAppOpen();
    setLaunchRevealDone(true);
  }, [springAppOpen]);

  // 字体或迁移未就绪前不渲染任何内容（启动屏仍显示）
  if (!loaded || !migrated) return null;

  return (
    // ThemeProvider：提供全局主题上下文（颜色、深浅色模式等）
    <ThemeProvider>
      <MemberNameAnimationProvider>
        <SessionBootstrap />
        <AuthRouteGuard>
          <Animated.View style={[{ flex: 1 }, appScaleStyle]}>
            <RootStack />
          </Animated.View>
          <NotificationSnackbarHost />
          <PushNotificationRouteHandler />
          <PushNotificationTokenRegistrar />
          <CallInviteHost />
          <AccountSwitcherSheet />
          <LoginSecurityCodeGate />
        </AuthRouteGuard>
        {!launchRevealDone ? (
          <LaunchReveal
            play={nativeSplashHidden}
            onReveal={springAppOpen}
            onFinish={handleLaunchRevealFinish}
          />
        ) : null}
      </MemberNameAnimationProvider>
    </ThemeProvider>
  );
}

// 用 Sentry 包裹根组件（启用触摸/导航埋点）；未配置 DSN 时返回原组件、行为不变。
export default wrapWithSentry(RootLayout);
