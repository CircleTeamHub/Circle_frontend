import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { resetUploadProgress } from '@/stores/upload-progress-store';
import { AppOperationsHost } from "@/components/app/AppOperationsHost";
// 导入 React Navigation 的主题系统，用于给导航栏（header、tab bar 等）应用深色/浅色主题
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import {
  Redirect,
  router,
  Stack,
  useNavigationContainerRef,
  useSegments,
} from 'expo-router';          // Expo Router 的 Stack 导航（页面栈）
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar'; // 控制顶部状态栏样式（文字颜色等）
// 必须在入口文件最早引入，启用动画引擎。
import 'react-native-reanimated';
import { ActivityIndicator, AppState, NativeModules, Platform, View } from 'react-native';
import { rehydrateLanguageFromStorage } from '@/i18n';
import { installAlertBridge } from '@/utils/alert-bridge';
import { initEncryptedStorage, migrateFromAsyncStorage } from '@/storage';
import { excludeMmkvDirFromIOSBackup } from '@/storage/ios-backup-exclusion';
import { silenceDomBridgeRejection } from '@/utils/silence-dom-bridge-rejection';
import { installNavigationDedupe } from '@/utils/navigation-dedupe';
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
import { ActiveCallHost } from '@/features/call/screens/GroupCallScreen';
import { LoginApprovalHost } from '@/features/security/components/LoginApprovalHost';
import {
  registerDeviceIdProvider,
  registerFreshConnectionTransport,
  registerRequestTraceHooks,
  registerStableDeviceIdProvider,
} from '@/services/api/client';
import { createFreshConnectionTransport } from '@/services/api/fresh-connection-transport';
import { diagnosticNow } from '@/observability/http-diagnostics';
import { createRequestTraceHooks } from '@/observability/request-trace';
import { getDeviceId, getStableDeviceId } from '@/services/auth/device-id';
import { AppBlurTarget } from '@/components/app/app-blur-target';
import { AppDialogHost } from '@/components/app/app-dialog-host';
import { TopNoticeHost } from '@/components/app/top-notice-host';
import { NoteRatingFlowHost } from '@/features/notes/rating/NoteRatingFlowHost';
import { WebDocumentTitle } from '@/components/app/web-document-title';
import { AppUpdateHost } from '@/features/app-update/AppUpdateHost';
import { ThemeProvider, useTheme } from '@/theme';
import {
  initSentry,
  wrapWithSentry,
  captureSentryTestError,
  registerSentryNavigationContainer,
  setSentryUserId,
  setSentryRoute,
} from '@/observability/sentry';
import { reportHandledFailure } from '@/observability/report-failure';
import { recordSessionDiagnostic } from '@/observability/session-diagnostics';
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

// 过滤 Expo DOM 组件在导航卸载竞态时抛出的 injectJavaScript 拒绝（属于已知良性错误）
silenceDomBridgeRejection();

// 全局防连点：同一目标短时间内只 push/navigate 一次（双击、转场途中再点不会叠两层页面）。
installNavigationDedupe(router);

// 每个 API 请求带上本机设备 ID（陌生设备登录验证），要早于任何请求注册。
registerDeviceIdProvider(getDeviceId);
registerStableDeviceIdProvider(getStableDeviceId);
// 安卓：卡住的 GET 的备份请求走独立连接池（一定是新连接）；其余平台和旧原生包为 null，照常 fetch。
registerFreshConnectionTransport(createFreshConnectionTransport());

// 请求卡住时记下「卡在哪一步」，随超时上报带走（见 observability/request-trace）。
// 只在原生端：web 的 fetch 不经过 RN 的 XMLHttpRequest。
if (Platform.OS !== 'web') {
  registerRequestTraceHooks(
    createRequestTraceHooks({
      now: diagnosticNow,
      getAppState: () => AppState.currentState ?? 'unknown',
      // 进程级常驻：随 app 生命周期存在，不需要移除。
      subscribeAppState: (listener) => {
        AppState.addEventListener('change', listener);
      },
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      xhrPrototype: (globalThis.XMLHttpRequest?.prototype ?? null) as unknown as Record<string, unknown> | null,
    }),
  );
}

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
      const diagnosticId = recordSessionDiagnostic('startup-storage-failed');
      reportHandledFailure('startup', 'storageInit', err, { diagnosticId });
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
        {/* 点消息横幅弹出的半屏聊天:透明底,下面的页面保持原样。 */}
        <Stack.Screen
          name="quick-chat"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
        {/* 半屏聊天里打开的分享选择 / 转账 / 选位置:必须是模态才能盖在半屏之上
            (iOS 会把模态之后的普通 push 页放到模态下面),返回后仍停在半屏。
            用 fullScreenModal 而不是卡片式 modal:这些页面按 insets.top 留顶部空白。 */}
        <Stack.Screen
          name="chat-sheet"
          options={{ presentation: 'fullScreenModal' }}
        />
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
// 职责：后台初始化本地存储和认证状态，挂载主题 Provider 与路由结构。
function RootLayout() {
  const sentryRoute = `/${useSegments().join('/')}`;
  // 导航追踪：冷启动指标和 XHR span 都要挂在导航 transaction 上才会被发出。
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    setSentryRoute(sentryRoute);
  }, [sentryRoute]);

  useLayoutEffect(() => {
    const initial = useAuthStore.getState();
    let sessionEpoch = initial.sessionEpoch;
    let userId = initial.isAuthenticated ? initial.user?.id ?? null : null;
    setSentryUserId(userId);
    // 直接订阅，避免登录/退出后等下一次 React effect 才更新，期间报错归到旧账号。
    return useAuthStore.subscribe((state) => {
      const nextUserId = state.isAuthenticated ? state.user?.id ?? null : null;
      if (nextUserId !== userId) {
        userId = nextUserId;
        setSentryUserId(userId);
      }
      if (state.sessionEpoch !== sessionEpoch) {
        sessionEpoch = state.sessionEpoch;
        resetUploadProgress();
      }
    });
  }, []);

  /**
   * 旧版 AsyncStorage → MMKV 一次性数据迁移闸门。
   *
   * 迁移结束前 zustand store 已经用空 MMKV 同步完成了一次 hydration，
   * 因此迁移完成后认证 store 需要重新读取 MMKV，并刷新 i18n；其余持久化 store
   * 在认证水合后后台重新读取。ThemeProvider 与路由会立即挂载，AuthRouteGuard
   * 在认证状态可用前负责渲染加载态。
   */
  useEffect(() => {
    registerSentryNavigationContainer(navigationRef);
  }, [navigationRef]);

  useEffect(() => {
    // 引导逻辑搬到模块级 ensureStartupBootstrap()（记忆化 → 只跑一次）。
    // 认证 store 与其余持久化状态继续在后台恢复，不阻塞首屏路由渲染。
    void ensureStartupBootstrap();
  }, []);

  // 原生启动屏不再由 JS 手动阻塞；认证 store 水合期间由 AuthRouteGuard
  // 渲染现有路由加载态，首屏不会继续停留在系统启动背景上。
  useEffect(() => {
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
  }, []);

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
            <ActiveCallHost />
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
          {/* 聊天笔记卡片长按 / 我的笔记 ⋯ 面板里打差评的原因面板。 */}
          <NoteRatingFlowHost />
          <UploadProgressHost />
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
