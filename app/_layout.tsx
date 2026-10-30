import { AppOperationsHost } from "@/components/app/AppOperationsHost";
// 导入 React Navigation 的主题系统，用于给导航栏（header、tab bar 等）应用深色/浅色主题
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import {
  Redirect,
  Stack,
  useNavigationContainerRef,
  useSegments,
} from 'expo-router';          // Expo Router 的 Stack 导航（页面栈）
import * as SplashScreen from 'expo-splash-screen'; // 控制启动屏（闪屏）的显示与隐藏
import { useEffect, useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar'; // 控制顶部状态栏样式（文字颜色等）
// 必须在入口文件最早引入，启用动画引擎。
import 'react-native-reanimated';
import { ActivityIndicator, NativeModules, Platform, View } from 'react-native';
import { rehydrateLanguageFromStorage } from '@/i18n';
import { installAlertBridge } from '@/utils/alert-bridge';
import { initEncryptedStorage, migrateFromAsyncStorage } from '@/storage';
import { excludeMmkvDirFromIOSBackup } from '@/storage/ios-backup-exclusion';
import { silenceDomBridgeRejection } from '@/utils/silence-dom-bridge-rejection';
import { ensureLiveKitGlobals } from '@/utils/livekit-globals';
import { useAuthStore } from '@/stores/authStore';
import {
  E2E_TARGET_MARKER_ENABLED,
  RUNTIME_API_TARGET_ID,
} from '@/constants/config';

// 项目自定义主题系统：ThemeProvider 提供主题上下文，useTheme 读取当前主题
import { getAuthRouteDecision } from '@/components/app/auth-route-policy';
import { LoginSecurityCodeGate } from '@/components/app/login-security-code-gate';
import { SessionBootstrap } from '@/components/app/session-bootstrap';
import { MemberNameAnimationProvider } from '@/components/ui/member-name-animation';
import { AccountSwitcherSheet } from '@/features/profile/components/account-switcher-sheet';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';
import { NotificationSnackbarHost } from '@/features/notifications/components/NotificationSnackbarHost';
import { PushNotificationRouteHandler } from '@/features/notifications/components/PushNotificationRouteHandler';
import { PushNotificationTokenRegistrar } from '@/features/notifications/components/PushNotificationTokenRegistrar';
import { CallInviteHost } from '@/features/call/components/CallInviteHost';
import { LoginApprovalHost } from '@/features/security/components/LoginApprovalHost';
import { registerDeviceIdProvider } from '@/services/api/client';
import { getDeviceId } from '@/services/auth/device-id';
import { AppBlurTarget } from '@/components/app/app-blur-target';
import { AppDialogHost } from '@/components/app/app-dialog-host';
import { TopNoticeHost } from '@/components/app/top-notice-host';
import { WebDocumentTitle } from '@/components/app/web-document-title';
import { AppUpdateHost } from '@/features/app-update/AppUpdateHost';
import { ThemeProvider, useTheme } from '@/theme';
import {
  initSentry,
  wrapWithSentry,
  captureSentryTestError,
  registerSentryNavigationContainer,
  setSentryUserId,
} from '@/observability/sentry';
import { reportHandledFailure } from '@/observability/report-failure';
import { devWarn } from '@/utils/dev-log';

// 将 expo-router 内置的 ErrorBoundary 重新导出，使其在根路由层生效（捕获页面级报错）
export { RouteErrorBoundary as ErrorBoundary } from '@/observability/RouteErrorBoundary';

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

// 阻止启动屏自动隐藏，等待认证所需的本地状态就绪后立即隐藏
SplashScreen.preventAutoHideAsync();

// 过滤 Expo DOM 组件在导航卸载竞态时抛出的 injectJavaScript 拒绝（属于已知良性错误）
silenceDomBridgeRejection();

// 每个 API 请求带上本机设备 ID（陌生设备登录验证），要早于任何请求注册。
registerDeviceIdProvider(getDeviceId);

async function registerLiveKitGlobals() {
  if (!NativeModules.WebRTCModule) {
    return;
  }

  try {
    const { registerGlobals } = await import('@livekit/react-native');
    ensureLiveKitGlobals(registerGlobals);
  } catch (error) {
    reportHandledFailure('startup', 'livekitGlobals', error);
  }
}

async function rehydratePersistedStore(name: string, store: PersistedStore) {
  const rehydrate = store.persist?.rehydrate;
  if (typeof rehydrate !== 'function') {
    devWarn(`[startup] ${name} store persist API unavailable; skipping rehydrate`);
    return;
  }

  try {
    await Promise.resolve(rehydrate());
  } catch (error) {
    reportHandledFailure('startup', 'storeRehydrate', error, { reason: name });
  }
}

async function rehydrateSecondaryStores(): Promise<void> {
  try {
    // 非关键 store 延迟加载，避免它们的模块求值和持久化读取阻塞首屏。
    const [
      { useKnownAccountsStore },
      { useChatPreferencesStore },
      { useDiscoverFilterStore },
      { useCircleNotificationStore },
    ] = await Promise.all([
      import('@/stores/knownAccountsStore'),
      import('@/features/chat/store/use-chat-preferences-store'),
      import('@/features/discover/store/use-discover-filter-store'),
      import('@/features/discover/store/use-circle-notification-store'),
    ]);

    await Promise.all([
      rehydratePersistedStore('known accounts', useKnownAccountsStore),
      rehydratePersistedStore('chat preferences', useChatPreferencesStore),
      rehydratePersistedStore('discover filter', useDiscoverFilterStore),
      rehydratePersistedStore('circle notification', useCircleNotificationStore),
    ]);
  } catch (error) {
    reportHandledFailure('startup', 'secondaryStoreImport', error);
  }
}

/**
 * 启动引导（AsyncStorage→MMKV 迁移 + 认证 store 水合 + i18n）用模块级
 * promise 记忆化，确保**只执行一次**：dev StrictMode 会重复挂载根布局、effect 也可能
 * 因重挂再次触发，若每次都 rehydrate，迟到的水合会和登录/注册写入抢跑、用旧持久化覆盖
 * 内存里的新会话（此前 onboarding 被弹回的放大器）。复用同一个 promise 后，无论触发几次
 * 都只真正水合一次。认证状态是进入路由的唯一关键依赖；偏好和通知等非关键
 * store 在认证水合后后台恢复，避免它们把首屏挡住。
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
      reportHandledFailure('startup', 'storageInit', err);
    }
    // 认证 hydration 决定首屏该进主界面还是登录页，必须在启动门内完成。
    await rehydratePersistedStore('auth', useAuthStore);
    rehydrateLanguageFromStorage();
    // 语言就位后再装：Alert.alert / Alert.prompt 全部改投自绘弹窗，默认按钮取当前语言。
    installAlertBridge();
    // 这些状态不会决定首个路由。放到认证水合之后后台执行，首屏先出来，旧版
    // AsyncStorage 迁移已经完成，因此不会读到迁移前的快照。
    void rehydrateSecondaryStores();
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

      {/* Stack 导航：所有页面以"从右滑入"的动画叠加展示，全局隐藏 header。
          开启横向返回手势，让带有自定义返回按钮的页面也支持从左侧滑回。 */}
      <Stack
        screenOptions={{
          // 看不见的页面冻结渲染(切走的 tab、栈里更深的页面),不再跟着每条消息重算。
          freezeOnBlur: true,
          headerShown: false,                          // 所有页面不显示系统 header
          animation: 'slide_from_right',               // 页面切换动画：从右侧滑入
          contentStyle: { backgroundColor: colors.background },
          fullScreenGestureEnabled: true,
          fullScreenGestureShadowEnabled: false,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
        }}
      >
        {/* 四个顶层路由组，对应 app/(tabs)、(auth)、(chat)、(social) 目录 */}
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen
          name="(onboarding)"
          options={{
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
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
  const hasCachedSession = useAuthStore(
    (state) =>
      state.isAuthenticated &&
      typeof state.accessToken === 'string' &&
      state.accessToken.length > 0 &&
      typeof state.refreshToken === 'string' &&
      state.refreshToken.length > 0 &&
      Boolean(state.user?.id),
  );
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const accountSwitching = useAccountSwitcherStore((state) => state.switching);
  const addingAccount = useAccountSwitcherStore((state) => state.addingAccount);
  const { colors } = useTheme();
  const decision = getAuthRouteDecision({
    firstSegment,
    isAuthenticated,
    isLoading,
    hasCachedSession,
    onboardingRequired,
    accountSwitching,
    addingAccount,
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
// 职责：完成认证所需的本地存储初始化 → 立即隐藏原生启动屏 → 挂载主题 Provider → 渲染路由结构
function RootLayout() {
  const sentryUserId = useAuthStore((state) => state.user?.id ?? null);
  // 导航追踪：冷启动指标和 XHR span 都要挂在导航 transaction 上才会被发出。
  const navigationRef = useNavigationContainerRef();

  /**
   * 旧版 AsyncStorage → MMKV 一次性数据迁移闸门。
   *
   * 迁移结束前 zustand store 已经用空 MMKV 同步完成了一次 hydration，
   * 因此迁移完成后认证 store 需要重新读取 MMKV，并刷新 i18n；其余持久化 store
   * 在认证水合后后台重新读取。主题在迁移完成后才挂载 ThemeProvider，初始
   * useState 即可读到迁移过的值。
   */
  const [startupReady, setStartupReady] = useState(false);
  useEffect(() => {
    setSentryUserId(sentryUserId);
  }, [sentryUserId]);

  useEffect(() => {
    registerSentryNavigationContainer(navigationRef);
  }, [navigationRef]);

  useEffect(() => {
    let cancelled = false;

    // 引导逻辑搬到模块级 ensureStartupBootstrap()（记忆化 → 只跑一次）。
    // 这里只负责在认证 store 水合后解除启动闸门；其余 store 已在后台继续恢复。
    ensureStartupBootstrap().finally(() => {
      if (!cancelled) {
        setStartupReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 原生启动屏只作为系统级加载背景，不再叠加 JS 设计或过渡动画。认证所需的
  // 本地状态一就绪就隐藏它；/auth/me 和非关键 store 继续在页面背后执行。
  useEffect(() => {
    if (!startupReady) return;
    SplashScreen.hideAsync().catch(() => {
      // 已经被隐藏；忽略即可。
    });

    // OTA 错误监听和 LiveKit 全局注册都不影响首屏路由，延迟到首帧之后，避免
    // 它们的模块初始化争抢启动时的 JS 线程。
    const timer = setTimeout(() => {
      void import('@/features/app-update/ota-health')
        .then(({ startOtaHealthReporting }) => {
          startOtaHealthReporting();
        })
        .catch((error) => {
          reportHandledFailure('startup', 'otaHealthImport', error);
        });
      void registerLiveKitGlobals();
    }, 0);
    return () => clearTimeout(timer);
  }, [startupReady]);

  // 认证 store 水合前不渲染路由（原生启动背景仍显示）。
  if (!startupReady) return null;

  const appContent = (
    // ThemeProvider：提供全局主题上下文（颜色、深浅色模式等）
    <ThemeProvider>
      <MemberNameAnimationProvider>
        <AppUpdateHost />
        <AppOperationsHost />
        <SessionBootstrap />
        <AuthRouteGuard>
          {/* Android 玻璃面（弹窗 / 顶部横幅）的模糊靶子：整棵 App 内容。 */}
          <AppBlurTarget>
          <View style={{ flex: 1 }}>
            <RootStack />
            {/* E2E 运行时目标标记：只在 dev / 测试构建挂载（见 config.ts），
                商店包不多出无标签可访问元素、也不暴露 API origin。 */}
            {E2E_TARGET_MARKER_ENABLED ? (
              <View
                accessible
                testID={RUNTIME_API_TARGET_ID}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 1,
                  height: 1,
                  opacity: 0.01,
                }}
              />
            ) : null}
          </View>
          </AppBlurTarget>
          <NotificationSnackbarHost />
          {/* 顶部提醒（操作回执 toast），与消息横幅同一套外壳。 */}
          <TopNoticeHost />
          <PushNotificationRouteHandler />
          <PushNotificationTokenRegistrar />
          <CallInviteHost />
          {/* 陌生设备登录：本机作为受信任设备时弹「是否是你本人」并下发验证码。 */}
          <LoginApprovalHost />
          <AccountSwitcherSheet />
          <LoginSecurityCodeGate />
          {/* 三端统一的弹窗宿主：Alert.alert / Alert.prompt 经 alert-bridge 全部投到这里。 */}
          <AppDialogHost />
          {/* Web 专属：标签页标题 + 未读数前缀（经 expo-router/head）。 */}
          {Platform.OS === 'web' ? <WebDocumentTitle /> : null}
        </AuthRouteGuard>
      </MemberNameAnimationProvider>
    </ThemeProvider>
  );

  return appContent;
}

// 用 Sentry 包裹根组件（启用触摸/导航埋点）；未配置 DSN 时返回原组件、行为不变。
export default wrapWithSentry(RootLayout);
