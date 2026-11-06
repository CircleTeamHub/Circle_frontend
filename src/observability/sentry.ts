// Sentry wiring for crash / error reporting. Kept as a small, injectable module
// so the gating logic is unit-testable and the root layout stays declarative.
//
// Dormant by default: Sentry only initializes when a DSN is configured via the
// EXPO_PUBLIC_SENTRY_DSN build-time env var or expo config `extra.sentryDsn`.
// With no DSN it is a complete no-op — nothing is sent and nothing crashes.
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import type {
  Breadcrumb,
  Event,
  EventHint,
  ErrorEvent,
  Metric,
  SpanJSON,
  TransactionEvent,
} from '@sentry/core';
import {
  readDiagnosticBreadcrumbs,
  resetDiagnosticBreadcrumbs,
  type DiagnosticBreadcrumb,
} from '@/utils/client-diagnostics';
import { isSensitiveFieldKey } from '@/utils/redact';
import { STATIC_ROUTE_SEGMENTS } from './route-segments';
import { TRACED_SPAN_NAMES } from './tracing';
import { allowedMetricAttributes, metricDefinition } from './metrics';
import { safeHttpEndpoint } from './http-diagnostics';
import {
  isBenignDomBridgeRejection,
  rejectionMessage,
  shouldReportUnhandledRejection,
} from './unhandled-rejection-filter';

interface NavigationIntegrationLike {
  registerNavigationContainer: (navigationContainerRef: unknown) => void;
}

/** Minimal slice of the Sentry SDK we depend on — lets tests inject a fake. */
export interface SentryLike {
  init: (options: Record<string, unknown>) => void;
  wrap: <P>(component: P) => P;
  reactNavigationIntegration?: (options: {
    useFullPathsForNavigationRoutes: boolean;
  }) => NavigationIntegrationLike;
}

// Adapt the SDK's wider types to our minimal interface at this single boundary.
const defaultClient = Sentry as unknown as SentryLike;
let sentryInitialized = false;
let navigationIntegration: NavigationIntegrationLike | undefined;

/**
 * 导航追踪是性能数据的根：冷启动指标挂在第一个导航 transaction 上，XHR span
 * 也要有父 span 才会被发出。没有它，tracesSampleRate 再高也一条性能数据都没有。
 * 全路径命名（__root/(tabs)/messages/index）由 sanitizeNavigationRouteName 归一化。
 */
function createNavigationIntegration(
  client: SentryLike,
): NavigationIntegrationLike | undefined {
  if (typeof client.reactNavigationIntegration !== 'function') return undefined;
  try {
    return client.reactNavigationIntegration({
      useFullPathsForNavigationRoutes: true,
    });
  } catch {
    return undefined;
  }
}

export interface SentryConfigSources {
  env?: Record<string, string | undefined>;
  extra?: Record<string, unknown> | null;
}

function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Resolves the Sentry DSN from, in order: the EXPO_PUBLIC_SENTRY_DSN build-time
 * env var, then expo config `extra.sentryDsn`. Returns undefined when neither is
 * set so Sentry stays disabled.
 */
export function resolveSentryDsn(sources: SentryConfigSources = {}): string | undefined {
  // Keep the default access syntactically direct so Expo can replace this at
  // build time. Tests and callers may still inject an isolated env object.
  const envDsn = sources.env
    ? sources.env.EXPO_PUBLIC_SENTRY_DSN
    : process.env.EXPO_PUBLIC_SENTRY_DSN;
  const extra =
    sources.extra ?? (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? {};

  return readTrimmed(envDsn) ?? readTrimmed(extra?.sentryDsn);
}

export interface InitSentryOptions {
  client?: SentryLike;
  dsn?: string;
  environment?: string;
  tracesSampleRate?: number;
  release?: string;
  dist?: string;
}

/**
 * Initializes Sentry only when a DSN is configured. Safe to call unconditionally
 * at startup — without a DSN it is a no-op and returns false.
 */
export function initSentry(options: InitSentryOptions = {}): boolean {
  const client = options.client ?? defaultClient;
  const dsn = options.dsn ?? resolveSentryDsn();
  if (!dsn) return false;

  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const extra =
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? {};
  const defaultEnvironment =
    extra.appVariant === 'preprod'
      ? 'preproduction'
      : isDev
        ? 'development'
        : 'production';
  const configuredSampleRate = options.tracesSampleRate;
  const tracesSampleRate =
    typeof configuredSampleRate === 'number' &&
    Number.isFinite(configuredSampleRate) &&
    configuredSampleRate >= 0 &&
    configuredSampleRate <= 1
      ? configuredSampleRate
      : isDev
        ? 1.0
        : 0.05;
  const release =
    readTrimmed(options.release) ??
    readTrimmed(process.env.EXPO_PUBLIC_SENTRY_RELEASE);
  const dist =
    readTrimmed(options.dist) ?? readTrimmed(process.env.EXPO_PUBLIC_SENTRY_DIST);
  const navigation = createNavigationIntegration(client);
  try {
    client.init({
      dsn,
      environment: readTrimmed(options.environment) ?? defaultEnvironment,
      ...(release ? { release } : {}),
      ...(dist ? { dist } : {}),
      // Native crashes + unhandled JS errors are captured by default.
      //
      // 生产采样率不能是 0：那等于移动端零性能数据。后端 Prometheus 覆盖的是
      // 服务端视角的接口延迟，看不到弱网、TLS、客户端渲染和本地 SQLite 写入 ——
      // 对 IM 产品，「消息发送慢」到底慢在哪一段就无法回答。5% 足够看趋势，
      // 又把 Sentry 配额消耗控制在可预期范围内。
      tracesSampleRate,
      integrations: navigation ? [navigation] : [],
      // 原生端默认是 [/.*/]：每个 XHR 都带 sentry-trace / baggage 头，连发往第三方
      // 存储的预签名上传 PUT 也带，等于把 release 和 DSN public key 发给第三方。
      // 后端不消费这两个头（请求串联走 X-Request-Id），所以一个都不发。空数组会
      // 覆盖 SDK 默认值；undefined 不会。将来后端接分布式追踪时再收窄到 API 源，
      // 同时把这两个头加进后端 CORS allowedHeaders（web 端跨源会触发预检）。
      tracePropagationTargets: [],
      // 会话统计（release health：崩溃率 / 无崩溃会话比例）。原生 SDK 默认就开；
      // web 端只有显式为 true 才挂 browserSessionIntegration，之前 web 一条会话都没有。
      // 账号关联只设置内部 user.id，邮箱、手机号等仍不发送。
      enableAutoSessionTracking: true,
      // Never attach PII (IP, cookies, request bodies) by default.
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      // SDK 在 beforeSend 之前按这个深度规整事件（默认 3）。诊断面包屑在
      // extra.clientDiagnostics[i].details.* —— 第 4 层，默认深度下会被压成 "[Object]"，
      // 「出错前 20 个请求」就整段丢了。值本身仍由 beforeSend 的白名单逐项把关。
      normalizeDepth: 5,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Native crash capture remains enabled by the SDK default. These JS
      // hooks cannot scrub payload fields emitted only by native crash code.
      // Manual reportError calls already sanitize their payloads, but native /
      // unhandled SDK events and automatic breadcrumbs bypass that helper.
      beforeSend: filterAndSanitizeErrorEvent,
      beforeBreadcrumb: sanitizeAutomaticBreadcrumb,
      beforeSendTransaction: sanitizeAutomaticTransaction,
      beforeSendSpan: sanitizeAutomaticSpan,
      beforeSendMetric: sanitizeMetric,
    });
    sentryInitialized = true;
    navigationIntegration = navigation;
    return true;
  } catch {
    sentryInitialized = false;
    navigationIntegration = undefined;
    return false;
  }
}

/**
 * 把 Expo Router 的导航容器交给 Sentry 导航追踪。Sentry 未初始化时是 no-op；
 * 重复注册同一个 ref 由 SDK 自己去重。
 */
export function registerSentryNavigationContainer(navigationContainerRef: unknown): void {
  if (!navigationIntegration) return;
  try {
    navigationIntegration.registerNavigationContainer(navigationContainerRef);
  } catch {
    // Observability must never change navigation behavior.
  }
}

let sentryUserId: string | null = null;

/** 身份入口只接受内部不透明 ID，不接受邮箱、昵称或其他个人资料。 */
function normalizedUserId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

interface UserIdentityClient {
  setUser: (user: { id: string } | null) => void;
  getIsolationScope?: () => { clearBreadcrumbs: () => void };
  getCurrentScope?: () => { clearBreadcrumbs: () => void };
}

/** 用户明确授权按内部 ID 排障；身份改变时丢弃上一账号的操作记录。 */
export function setSentryUserId(
  userId: string | null | undefined,
  client: UserIdentityClient = Sentry,
): void {
  const nextUserId = normalizedUserId(userId);
  if (nextUserId !== sentryUserId) {
    sentryUserId = nextUserId;
    navigationHistory = [];
    routeContext = routeContext.currentRoute ? { currentRoute: routeContext.currentRoute } : {};
    try {
      resetDiagnosticBreadcrumbs();
    } catch {
      // 可选诊断失败不能阻断用户 scope 更新。
    }
    try {
      client.getIsolationScope?.().clearBreadcrumbs();
      client.getCurrentScope?.().clearBreadcrumbs();
    } catch {
      // SDK 面包屑清理失败不能阻断登录/退出。
    }
  }
  if (!sentryInitialized && client === Sentry) return;
  try {
    client.setUser(nextUserId ? { id: nextUserId } : null);
  } catch {
    // Observability must never change auth/session behavior.
  }
}

export interface WrapWithSentryOptions {
  client?: SentryLike;
  enabled?: boolean;
}

/**
 * Wraps the root component with Sentry's instrumentation when a DSN is
 * configured; otherwise returns it untouched so the app behaves identically
 * with Sentry disabled.
 */
export function wrapWithSentry<P>(component: P, options: WrapWithSentryOptions = {}): P {
  const client = options.client ?? defaultClient;
  const enabled = options.enabled ?? Boolean(resolveSentryDsn());
  if (!enabled) return component;
  try {
    return client.wrap(component);
  } catch {
    return component;
  }
}

/**
 * TEMPORARY verification helper — fires one test error so you can confirm in-app
 * Sentry capture works after a native rebuild. Gate the call site behind a flag
 * (see app/_layout.tsx) and remove the flag once confirmed.
 */
export function captureSentryTestError(
  message = 'frontend Sentry test from app',
): void {
  Sentry.captureException(new Error(message));
}

export interface ReportErrorContext {
  [key: string]: unknown;
}

type SentryCaptureContext = {
  user: { id: string | undefined };
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  fingerprint?: string[];
};

const SENSITIVE_URL_PATTERN = /https?:\/\/[^\s"'<>)]*\?[^\s"'<>)]*/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRESIGNED_URL_MARKERS = [
  'X-Amz-Algorithm=',
  'X-Amz-Credential=',
  'X-Amz-Signature=',
  'x-id=PutObject',
];
// 嵌套字段的敏感名单只有一份，在 utils/redact.ts（isSensitiveFieldKey）。这里曾经
// 抄过一份，与日志那份分叉过两次。
const STALL_DIAGNOSTIC_COUNTS = [
  'xhrAckMs',
  'xhrHeadersMs',
  'xhrDoneMs',
  'inflight',
  'completedWhileWaiting',
  'loopLagMs',
] as const;
const STALL_DIAGNOSTIC_FLAGS = ['xhrEarlyEvent', 'appStateChanged'] as const;
const STALL_DIAGNOSTIC_ENUMS: Readonly<Record<string, RegExp>> = {
  xhrStage: /^(untracked|sent|acked|headers|loading|done)$/,
  appState: /^(active|background|inactive|unknown|extension)$/,
  retry: /^(recovered|failed)$/,
};
const STALL_DIAGNOSTIC_KEYS = [
  ...STALL_DIAGNOSTIC_COUNTS,
  ...STALL_DIAGNOSTIC_FLAGS,
  ...Object.keys(STALL_DIAGNOSTIC_ENUMS),
];
// 能在 Sentry 里按 tag 筛的那几项：「卡在哪一步」「重试救没救回来」「前后台」。
const STALL_DIAGNOSTIC_TAG_KEYS = ['stage', 'xhrStage', 'retry', 'appState'];

function isSafeStallDiagnostic(key: string, value: unknown): boolean {
  // stage 也进 tag：现有取值都是代码里的标识符（handshake / local-read / reading-body…）。
  if (key === 'stage') return typeof value === 'string' && SAFE_ERROR_CODE.test(value);
  if ((STALL_DIAGNOSTIC_COUNTS as readonly string[]).includes(key)) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }
  if ((STALL_DIAGNOSTIC_FLAGS as readonly string[]).includes(key)) {
    return typeof value === 'boolean';
  }
  const pattern = STALL_DIAGNOSTIC_ENUMS[key];
  return pattern ? typeof value === 'string' && pattern.test(value) : true;
}

const SAFE_REPORT_CONTEXT_KEYS = new Set([
  'endpointPath',
  'method',
  'status',
  'apiCode',
  'errorCode',
  'failureKind',
  'component',
  'operation',
  'kind',
  'attempts',
  'platform',
  'contentType',
  'code',
  'storageCode',
  'size',
  'category',
  'agentIndex',
  'source',
  'stage',
  'reason',
  'traceId',
  'requestId',
  'durationMs',
  'page',
  'currentRoute',
  'previousRoute',
  // 请求卡顿现场（observability/request-trace + services/api/client）：只收枚举与计数，
  // 形状由 isSafeStallDiagnostic 把关。
  ...STALL_DIAGNOSTIC_KEYS,
]);
const SAFE_EVENT_TAG_KEYS = new Set([
  'endpointPath',
  'method',
  'status',
  'apiCode',
  'errorCode',
  'failureKind',
  'component',
  'operation',
  'kind',
  'traceId',
  'requestId',
  'code',
  'storageCode',
  'currentRoute',
  'previousRoute',
  ...STALL_DIAGNOSTIC_TAG_KEYS,
]);
const SAFE_DIAGNOSTIC_DETAIL_KEYS = new Set([
  'circleId',
  'conversationID',
  'notificationId',
  'targetMsgID',
  'requestIdentifier',
  'source',
  'stage',
  'reason',
  'platform',
  'selectedCount',
  'succeeded',
  'failed',
  'total',
  'loaded',
  'limit',
  'fetched',
  'inserted',
  'page',
  'endpointPath',
  'method',
  'status',
  'durationMs',
  'requestId',
  'failureKind',
  'errorName',
]);

const REDACTED_TRANSACTION = '[REDACTED_TRANSACTION]';
/** Expo Router 的动态段字面量，如 `[conversationId]`；本身不含用户数据。 */
const ROUTE_PARAM_SEGMENT = /^\[\.{0,3}[A-Za-z][A-Za-z0-9_]*\]$/;
const MAX_ROUTE_SEGMENTS = 8;
const SAFE_WS_TRACE_ID =
  /^ws-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 把 transaction 名收敛成「路由形状」。
 *
 * 之前这里是无条件替换成常量，隐私上无懈可击，但代价是 Sentry 里每个 issue
 * 的标题都一样、issue 列表无法按屏幕区分，没有堆栈的事件还会全部塌缩成同一个
 * issue。折中：保留纯静态的路由段（这才是分组价值所在），把任何可能是标识符
 * 的段换成 `:id`；整体形状不像路由就退回原来的全遮蔽。
 *
 * 判定是**白名单**而不是「看起来像不像标识符」：后端 id 是不透明的，
 * MyCirclesScreen 会 router.push(`/(tabs)/discover/circle/${encodeURIComponent(id)}`)，
 * 一个纯字母的 circle id（privatecircle）用任何字符类规则都无法与真正的静态段
 * 区分开 —— 只要靠猜就一定漏。所以只有出现在真实路由模板里的段才保留
 * （见 route-segments.ts，由 app/ 派生并由测试钉住），其余一律 :id。
 *
 * 与后端 metrics/route-normalizer 的归一化目的一致：既能按路由聚合，
 * 又不让标识符进入标签。
 */
export function sanitizeTransactionName(value: unknown): string {
  if (typeof value !== 'string') return REDACTED_TRANSACTION;
  const trimmed = value.trim();
  // 只接受以 / 开头的路径。带 scheme 的 URL、带 query 的字符串、自由文本
  // 全部落到这里 —— 它们的形状本来就不该出现在 transaction 名里。
  if (!trimmed.startsWith('/') || trimmed.length > 120) {
    return REDACTED_TRANSACTION;
  }
  if (/[?#\s@]/.test(trimmed)) return REDACTED_TRANSACTION;

  const segments = trimmed.split('/');
  // 前导 '/' 产生一个空首段；其余空段（`//`）不是合法路由形状。
  if (segments[0] !== '') return REDACTED_TRANSACTION;
  const rest = segments.slice(1);
  if (rest.length === 0 || rest.length > MAX_ROUTE_SEGMENTS) {
    return REDACTED_TRANSACTION;
  }

  const normalized = rest.map((segment) => {
    if (segment === '') return '';
    if (ROUTE_PARAM_SEGMENT.test(segment)) return '[param]';
    return STATIC_ROUTE_SEGMENTS.has(segment) ? segment : ':id';
  });
  if (normalized.some((segment) => segment === '')) return REDACTED_TRANSACTION;

  return `/${normalized.join('/')}`;
}

/** Expo Router 根导航器的内部路由名，不是 URL 段。 */
const NAVIGATION_ROOT_ROUTE = '__root';

/**
 * React Navigation 的路由名（`__root/(tabs)/messages/user/[id]`）是代码里的文件名，
 * 不含参数值；去掉根导航器和 index 段、补上前导 / 之后，按 URL 路径同一套白名单
 * 归一化。必须幂等：同一个名字先在根 span 上、再在 transaction 上各过一遍。
 */
function sanitizeNavigationRouteName(value: unknown): string {
  if (typeof value !== 'string') return REDACTED_TRANSACTION;
  const segments = value
    .trim()
    .split('/')
    .filter(
      (segment) =>
        segment !== '' && segment !== NAVIGATION_ROOT_ROUTE && segment !== 'index',
    );
  if (segments.length === 0) return '/';
  return sanitizeTransactionName(`/${segments.join('/')}`);
}

let routeContext: { currentRoute?: string; previousRoute?: string } = {};
interface NavigationStep {
  readonly timestamp: number;
  readonly from?: string;
  readonly to: string;
}
let navigationHistory: readonly NavigationStep[] = [];
const MAX_NAVIGATION_STEPS = 20;

/** 只接受路由模板，参数值再次按路由白名单移除。 */
export function setSentryRoute(route: string): void {
  const currentRoute = sanitizeNavigationRouteName(route);
  if (routeContext.currentRoute === currentRoute && navigationHistory.length > 0) return;
  const previousRoute = navigationHistory.length > 0 ? routeContext.currentRoute : undefined;
  routeContext = { currentRoute, previousRoute };
  navigationHistory = [...navigationHistory, {
    timestamp: Date.now(), ...(previousRoute ? { from: previousRoute } : {}), to: currentRoute,
  }].slice(-MAX_NAVIGATION_STEPS);
}

/**
 * 导航 transaction（source=component）按路由名归一化；tracing.ts 固定表里的自定义
 * span 名原样保留；其余仍走 URL 路径规则。
 */
function sanitizeEventTransactionName(value: unknown, source: unknown): string {
  if (typeof value === 'string' && TRACED_SPAN_NAMES.has(value)) return value;
  return source === 'component'
    ? sanitizeNavigationRouteName(value)
    : sanitizeTransactionName(value);
}

function sanitizeStringForSentry(value: string): string {
  const sanitized = value
    .replace(SENSITIVE_URL_PATTERN, '[REDACTED_URL]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_TOKEN]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
  return PRESIGNED_URL_MARKERS.some((marker) => sanitized.includes(marker))
    ? '[REDACTED]'
    : sanitized;
}

function sanitizeContextForSentry(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[MAX_DEPTH]';
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeStringForSentry(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContextForSentry(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveFieldKey(key)
      ? '[REDACTED]'
      : sanitizeContextForSentry(child, depth + 1);
  }
  return out;
}

/**
 * code / storageCode 会进 tag 和 fingerprint：只收常量形状（错误码枚举），自由文本
 * 进来会炸出无数个 issue，还可能带出响应体内容。其他键不受影响。
 */
const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_STORAGE_CODE = /^[A-Za-z]{1,64}$/;

function isSafeErrorCode(key: string, value: unknown): boolean {
  if (key === 'code') {
    return (
      (typeof value === 'number' && Number.isSafeInteger(value)) ||
      (typeof value === 'string' && SAFE_ERROR_CODE.test(value))
    );
  }
  if (key === 'storageCode') {
    return typeof value === 'string' && SAFE_STORAGE_CODE.test(value);
  }
  return true;
}

function sanitizeReportContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_REPORT_CONTEXT_KEYS) {
    if (!(key in context)) continue;
    const value = context[key];
    if (key === 'currentRoute' || key === 'previousRoute') {
      if (typeof value === 'string') safe[key] = sanitizeNavigationRouteName(value);
      continue;
    }
    if (
      key === 'traceId' &&
      (typeof value !== 'string' || !SAFE_WS_TRACE_ID.test(value))
    ) {
      continue;
    }
    if (key === 'requestId' && (typeof value !== 'string' || !SAFE_REQUEST_ID.test(value))) {
      continue;
    }
    if (key === 'durationMs' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      continue;
    }
    if (!isSafeErrorCode(key, value)) continue;
    if (!isSafeStallDiagnostic(key, value)) continue;
    if (
      value == null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = sanitizeContextForSentry(value);
    }
  }
  return safe;
}

function sanitizeStacktrace(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const frames = (value as Record<string, unknown>).frames;
  if (!Array.isArray(frames)) return undefined;
  return {
    frames: frames.map((frame) => {
      if (!frame || typeof frame !== 'object') return {};
      const source = frame as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      for (const key of [
        'filename',
        'function',
        'module',
        'lineno',
        'colno',
        'in_app',
        'instruction_addr',
        'addr_mode',
        'image_addr',
        'package',
      ]) {
        if (key in source) safe[key] = sanitizeContextForSentry(source[key]);
      }
      return safe;
    }),
  };
}

function sanitizeException(value: unknown, context: Record<string, unknown>): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const values = (value as Record<string, unknown>).values;
  if (!Array.isArray(values)) return undefined;
  return {
    values: values.map((entry) => {
      if (!entry || typeof entry !== 'object') return {};
      const source = entry as Record<string, unknown>;
      const safe: Record<string, unknown> = {
        value: safeErrorMessage(context, { name: source.type, message: source.value }),
      };
      if (typeof source.type === 'string') {
        safe.type = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(source.type)
          ? source.type
          : 'Error';
      }
      const stacktrace = sanitizeStacktrace(source.stacktrace);
      if (stacktrace) safe.stacktrace = stacktrace;
      if (source.mechanism && typeof source.mechanism === 'object') {
        const mechanism = source.mechanism as Record<string, unknown>;
        safe.mechanism = {
          ...(typeof mechanism.type === 'string'
            ? { type: sanitizeStringForSentry(mechanism.type) }
            : {}),
          ...(typeof mechanism.handled === 'boolean'
            ? { handled: mechanism.handled }
            : {}),
          ...(typeof mechanism.synthetic === 'boolean'
            ? { synthetic: mechanism.synthetic }
            : {}),
        };
      }
      return safe;
    }),
  };
}

function sanitizeThreads(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const values = (value as Record<string, unknown>).values;
  if (!Array.isArray(values)) return undefined;
  return {
    values: values.map((entry) => {
      if (!entry || typeof entry !== 'object') return {};
      const source = entry as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      for (const key of ['id', 'name', 'crashed', 'current', 'main']) {
        if (key in source) safe[key] = sanitizeContextForSentry(source[key]);
      }
      const stacktrace = sanitizeStacktrace(source.stacktrace);
      if (stacktrace) safe.stacktrace = stacktrace;
      return safe;
    }),
  };
}

function sanitizeEventTags(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_EVENT_TAG_KEYS) {
    const child = (value as Record<string, unknown>)[key];
    if (key === 'currentRoute' || key === 'previousRoute') {
      if (typeof child === 'string') safe[key] = sanitizeNavigationRouteName(child);
      continue;
    }
    if (
      key === 'traceId' &&
      (typeof child !== 'string' || !SAFE_WS_TRACE_ID.test(child))
    ) {
      continue;
    }
    if (key === 'requestId' && (typeof child !== 'string' || !SAFE_REQUEST_ID.test(child))) {
      continue;
    }
    if (!isSafeErrorCode(key, child)) continue;
    if (!isSafeStallDiagnostic(key, child)) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      safe[key] = sanitizeContextForSentry(child);
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function sanitizeClientDiagnostics(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const safe = value.slice(-20).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    if (
      typeof source.event !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(source.event)
    ) {
      return [];
    }

    const details: Record<string, unknown> = {};
    if (source.details && typeof source.details === 'object') {
      for (const key of SAFE_DIAGNOSTIC_DETAIL_KEYS) {
        const child = (source.details as Record<string, unknown>)[key];
        if (!isSafeDiagnosticDetail(key, child)) continue;
        if (
          child == null ||
          typeof child === 'string' ||
          typeof child === 'number' ||
          typeof child === 'boolean'
        ) {
          if (child !== undefined) details[key] = sanitizeContextForSentry(child);
        }
      }
    }
    const labels: Record<string, string> = {
      'api.request.completed': '请求完成',
      'api.request.failed': '请求失败',
      'api.request.slow': '请求耗时较长',
      'route.render.failed': '页面显示或退出失败',
      'navigation.back.pressed': '点击左上角返回',
      'chatSend.completed': '消息发送结束',
      'chatConnect.completed': '聊天连接结束',
      'mediaUpload.completed': '文件上传结束',
    };
    const label = labels[source.event] ?? `应用记录：${source.event}`;
    const summary = source.event.startsWith('api.request.')
      ? requestSummary(label, details)
      : label;
    const timestamp = typeof source.timestamp === 'number' && Number.isFinite(source.timestamp) && source.timestamp >= 0
      ? source.timestamp : undefined;
    return [{ summary, event: source.event, ...(timestamp !== undefined ? { timestamp } : {}), details }];
  });
  return safe.length > 0 ? safe : undefined;
}

function isSafeDiagnosticDetail(key: string, value: unknown): boolean {
  if (key === 'errorName') return typeof value === 'string' && /^(Error|TypeError|ReferenceError|RangeError|SyntaxError|AbortError|ApiError|StorageUploadError|ChatSendError|UserFacingError)$/.test(value);
  if (key === 'requestId') return typeof value === 'string' && SAFE_REQUEST_ID.test(value);
  if (key === 'durationMs') return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (key === 'status') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 599;
  if (key === 'method') return typeof value === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value);
  if (key === 'endpointPath') return typeof value === 'string' && value.length <= 160 && /^\/[A-Za-z0-9_:/().-]*$/.test(value);
  if (key === 'failureKind') return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);
  return true;
}

function sanitizeEventExtra(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const safe = sanitizeReportContext(source);
  const clientDiagnostics = sanitizeClientDiagnostics(source.clientDiagnostics);
  if (clientDiagnostics) safe.clientDiagnostics = clientDiagnostics;
  const history = sanitizeNavigationHistory(source.navigationHistory);
  if (history) safe.navigationHistory = history;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function sanitizeNavigationHistory(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const history = value.slice(-MAX_NAVIGATION_STEPS).flatMap(entry => {
    if (!isRecord(entry) || typeof entry.to !== 'string' ||
      typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp) || entry.timestamp < 0) return [];
    const to = sanitizeNavigationRouteName(entry.to);
    const from = typeof entry.from === 'string' ? sanitizeNavigationRouteName(entry.from) : undefined;
    return [{ timestamp: entry.timestamp, ...(from ? { from } : {}), to,
      summary: from ? `页面跳转：${from} → ${to}` : `进入页面：${to}` }];
  });
  return history.length > 0 ? history : undefined;
}

function sanitizedEventUser(value: unknown): { id: string } | undefined {
  const id = isRecord(value) ? normalizedUserId(value.id) : null;
  return id ? { id } : undefined;
}

function sanitizeAutomaticBaseEvent(event: Event): Event {
  if (!event || typeof event !== 'object') return event;
  const source = event as unknown as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of [
    'event_id',
    'timestamp',
    'start_timestamp',
    'platform',
    'level',
    'logger',
    'release',
    'dist',
    'environment',
    'server_name',
  ]) {
    if (key in source) safe[key] = sanitizeContextForSentry(source[key]);
  }
  const tags = sanitizeEventTags(source.tags);
  if (tags) safe.tags = tags;
  const user = sanitizedEventUser(source.user);
  if (user) safe.user = user;
  const extra = sanitizeEventExtra(source.extra);
  if (extra) safe.extra = extra;
  const errorContext = { ...tags, ...extra };
  if ('message' in source) {
    safe.message = safeErrorMessage(errorContext, { message: source.message });
  }
  if ('transaction' in source) {
    safe.transaction = sanitizeEventTransactionName(
      source.transaction,
      readTransactionSource(source.transaction_info),
    );
  }
  const exception = sanitizeException(source.exception, errorContext);
  if (exception) safe.exception = exception;
  const stacktrace = sanitizeStacktrace(source.stacktrace);
  if (stacktrace) safe.stacktrace = stacktrace;
  const threads = sanitizeThreads(source.threads);
  if (threads) safe.threads = threads;
  const contexts = sanitizeEventContexts(source.contexts);
  if (contexts) safe.contexts = contexts;
  if (Array.isArray(source.fingerprint)) {
    safe.fingerprint = source.fingerprint.map((part) =>
      sanitizeStringForSentry(String(part)),
    );
  }
  if (Array.isArray(source.breadcrumbs)) {
    safe.breadcrumbs = source.breadcrumbs.map(sanitizeAutomaticBreadcrumb);
  }
  // Native symbolication metadata is SDK-generated, not application content.
  for (const key of ['debug_meta', 'modules', 'sdk']) {
    if (key in source) safe[key] = sanitizeContextForSentry(source[key]);
  }
  return safe as Event;
}

/**
 * 未处理 Promise rejection 的过滤与限流。Hermes 上真正生效的 tracker 是 SDK 自己挂在
 * HermesInternal 上的（web 上是全局 unhandledrejection 事件），silence-dom-bridge-
 * rejection 的 promise 包 tracker 在那里从不触发 —— 所以闸门放在所有引擎都经过的
 * beforeSend，按 mechanism 只作用于未处理 rejection，手动 reportError 不受影响。
 * 签名取原始错误（脱敏之后 value 已被替换），在脱敏之前判断。
 */
function isUnhandledRejectionEvent(event: ErrorEvent): boolean {
  // Hermes / JSC：'onunhandledrejection'；web 的 browserGlobalHandlersIntegration 带命名
  // 空间前缀：'auto.browser.global_handlers.onunhandledrejection'。
  return (
    event.exception?.values?.some((value) => {
      const type = value.mechanism?.type;
      return (
        type === 'onunhandledrejection' ||
        (typeof type === 'string' && type.endsWith('.onunhandledrejection'))
      );
    }) ?? false
  );
}

function filterAndSanitizeErrorEvent(
  event: ErrorEvent,
  hint?: EventHint,
): ErrorEvent | null {
  if (event && typeof event === 'object' && isUnhandledRejectionEvent(event)) {
    const original = hint?.originalException ?? event.exception?.values?.[0]?.value;
    const message = rejectionMessage(original);
    if (
      isBenignDomBridgeRejection(message) ||
      !shouldReportUnhandledRejection(original, message)
    ) {
      return null;
    }
  }
  return sanitizeAutomaticEvent(event);
}

function sanitizeAutomaticEvent(event: ErrorEvent): ErrorEvent {
  // SDK 在捕获时已快照 user。旧账号/匿名事件延迟发送时不能搭载新账号的现场。
  const sameUser = (sanitizedEventUser(event.user)?.id ?? null) === sentryUserId;
  return {
    ...sanitizeAutomaticBaseEvent({
      ...event,
      extra: {
        ...(sameUser ? routeContext : {}),
        ...event.extra,
        clientDiagnostics: event.extra?.clientDiagnostics ?? (sameUser ? safeReadBreadcrumbs() : []),
        navigationHistory: event.extra?.navigationHistory ?? (sameUser ? navigationHistory : []),
      },
      tags: { ...(sameUser ? routeContext : {}), ...event.tags },
    }),
    type: undefined,
  };
}

/** SDK 自动补的指标属性里，只有这几项不是标识：版本、环境、SDK。 */
const SAFE_SDK_METRIC_ATTRIBUTES = [
  'sentry.release',
  'sentry.environment',
  'sentry.sdk.name',
  'sentry.sdk.version',
] as const;

/**
 * 指标的最后一道白名单：名字和类型必须与 metrics.ts 的表一致，单位取表里的，
 * 属性只留表里声明的枚举值和上面几项 SDK 元数据。SDK 自动补的 user.id /
 * user.email / user.name 在这里被剥掉；用户 ID 只用于事件归属，不作为指标标签。
 */
function sanitizeMetric(metric: Metric): Metric | null {
  if (!metric || typeof metric !== 'object') return null;
  const definition = metricDefinition(metric.name);
  if (!definition || definition.type !== metric.type) return null;
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) return null;
  const source = isRecord(metric.attributes) ? metric.attributes : {};
  const attributes: Record<string, unknown> = allowedMetricAttributes(definition, source);
  for (const key of SAFE_SDK_METRIC_ATTRIBUTES) {
    const value = source[key];
    if (typeof value === 'string' && value.length <= MAX_CONTEXT_STRING_LENGTH) {
      attributes[key] = value;
    }
  }
  return {
    name: metric.name,
    type: metric.type,
    value: metric.value,
    ...(definition.unit ? { unit: definition.unit } : {}),
    attributes,
  };
}

function sanitizeAutomaticBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb;
  const source = breadcrumb as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ['type', 'category', 'level', 'timestamp']) {
    if (key in source) safe[key] = sanitizeContextForSentry(source[key]);
  }
  const data = isRecord(source.data) ? source.data : {};
  if (source.category === 'navigation') {
    const routes: Record<string, string> = {};
    for (const key of ['from', 'to']) {
      const route = sanitizeNavigationRouteName(data[key]);
      if (route !== REDACTED_TRANSACTION) routes[key] = route;
    }
    safe.data = routes;
    safe.message = `页面跳转：${routes.from ?? '未知页面'} → ${routes.to ?? '未知页面'}`;
  } else if (source.type === 'http' || ['http', 'xhr', 'fetch'].includes(String(source.category))) {
    const details: Record<string, unknown> = {};
    if (isSafeDiagnosticDetail('method', data.method)) details.method = data.method;
    const endpoint = data.endpointPath ?? data.url;
    if (typeof endpoint === 'string') {
      const path = endpoint.replace(/^https?:\/\/[^/?#]+/i, '').replace(/^\/api\/v1(?=\/|$)/, '');
      details.endpointPath = safeHttpEndpoint(path);
    }
    const status = data.status ?? data.status_code;
    if (isSafeDiagnosticDetail('status', status)) details.status = status;
    safe.data = details;
    safe.message = requestSummary('接口请求', details);
  } else {
    safe.message = source.category === 'touch'
      ? '用户触摸界面（不记录界面文字）'
      : '应用记录（原始文本已隐藏）';
  }
  return safe as Breadcrumb;
}

function sanitizeAutomaticSpan(span: SpanJSON): SpanJSON {
  const safeData: Record<string, string | number | boolean> = {};
  for (const key of [
    'sentry.origin',
    'sentry.op',
    'sentry.source',
    'sentry.sample_rate',
  ] as const) {
    const value = span.data?.[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safeData[key] = value;
    }
  }

  return {
    data: safeData as SpanJSON['data'],
    span_id: span.span_id,
    start_timestamp: span.start_timestamp,
    trace_id: span.trace_id,
    ...(span.parent_span_id ? { parent_span_id: span.parent_span_id } : {}),
    ...(span.timestamp !== undefined ? { timestamp: span.timestamp } : {}),
    ...(span.op ? { op: sanitizeStringForSentry(span.op) } : {}),
    ...(span.origin ? { origin: span.origin } : {}),
    ...(span.status ? { status: span.status } : {}),
    ...(span.profile_id ? { profile_id: span.profile_id } : {}),
    ...(span.exclusive_time !== undefined
      ? { exclusive_time: span.exclusive_time }
      : {}),
    ...(span.is_segment !== undefined ? { is_segment: span.is_segment } : {}),
    ...(span.segment_id ? { segment_id: span.segment_id } : {}),
    ...(span.is_segment === true ? sanitizeSegmentSpanFields(span) : {}),
  };
}

/**
 * 根 span（is_segment）就是 transaction 本身。@sentry/core 先对它跑 beforeSendSpan，
 * 再把结果 merge 回 transaction 事件 —— 没带回来的 description / measurements 会以
 * undefined 覆盖 transaction 名和冷启动指标，之后才轮到 beforeSendTransaction。
 * 所以这两项要在这里按 transaction 的同一套规则保留下来。子 span 的 description
 * 照旧丢弃（常带 URL）。
 */
function sanitizeSegmentSpanFields(span: SpanJSON): Partial<SpanJSON> {
  const measurements = sanitizeMeasurements(span.measurements);
  return {
    description: sanitizeEventTransactionName(
      span.description,
      span.data?.['sentry.source'],
    ),
    ...(measurements ? { measurements } : {}),
  };
}

function hasValidSpanIds(span: SpanJSON): boolean {
  return (
    isValidHexId(span.trace_id, 32) &&
    isValidHexId(span.span_id, 16) &&
    (span.parent_span_id === undefined || isValidHexId(span.parent_span_id, 16))
  );
}

function sanitizeTraceContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (!isValidHexId(source.trace_id, 32) || !isValidHexId(source.span_id, 16)) {
    return undefined;
  }
  return {
    trace_id: source.trace_id,
    span_id: source.span_id,
    data: {},
    ...(isValidHexId(source.parent_span_id, 16)
      ? { parent_span_id: source.parent_span_id }
      : {}),
    ...(readSafeTraceField(source.op)
      ? { op: source.op }
      : {}),
    ...(readSafeTraceField(source.origin)
      ? { origin: source.origin }
      : {}),
    ...(readSafeTraceField(source.status)
      ? { status: source.status }
      : {}),
  };
}

/**
 * SDK 自动填的 contexts 里可以离开设备的字段（白名单）。没有它们就没法按机型、
 * 系统版本、App 版本或 OTA 版本筛崩溃。字段名对应 @sentry/react-native 7 的
 * devicecontext / expocontext 集成。
 *
 * 刻意不在单子上的：设备名（常是「张三的 iPhone」）、设备 ID、device_app_hash、
 * boot_time、精确的剩余内存/存储（组合起来可做设备指纹）、时区与语言（culture
 * 整个不收）、内核版本串（可能带主机名）、emergency_launch_reason（原生错误文本，
 * iOS 上带含安装 UUID 的沙盒路径）。新增字段前先确认它不是标识符。
 */
const SAFE_AUTOMATIC_CONTEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  device: [
    'model',
    'model_id',
    'family',
    'brand',
    'manufacturer',
    'arch',
    'simulator',
    'memory_size',
    'low_memory',
  ],
  os: ['name', 'version', 'build'],
  app: [
    'app_version',
    'app_build',
    'app_identifier',
    'app_name',
    'build_type',
    'in_foreground',
  ],
  ota_updates: [
    'is_enabled',
    'update_id',
    'channel',
    'runtime_version',
    'check_automatically',
    'is_embedded_launch',
    'is_emergency_launch',
    'is_using_embedded_assets',
    'launch_duration',
    'created_at',
  ],
};
const MAX_CONTEXT_STRING_LENGTH = 128;
const MAX_VIEW_NAMES = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeAutomaticContext(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const safe: Record<string, unknown> = {};
  for (const field of fields) {
    const child = value[field];
    if (typeof child === 'boolean' || (typeof child === 'number' && Number.isFinite(child))) {
      safe[field] = child;
    } else if (typeof child === 'string' && child.length <= MAX_CONTEXT_STRING_LENGTH) {
      safe[field] = sanitizeStringForSentry(child);
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** app.view_names 是 SDK 记下的当前路由名，与导航 transaction 名同一套归一化。 */
function sanitizeViewNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .slice(-MAX_VIEW_NAMES)
    .map(sanitizeNavigationRouteName)
    .filter((name) => name !== REDACTED_TRANSACTION);
  return names.length > 0 ? names : undefined;
}

function sanitizeEventContexts(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const safe: Record<string, unknown> = {};
  const trace = sanitizeTraceContext(value.trace);
  if (trace) safe.trace = trace;
  for (const [name, fields] of Object.entries(SAFE_AUTOMATIC_CONTEXT_FIELDS)) {
    const context = sanitizeAutomaticContext(value[name], fields);
    if (context) safe[name] = context;
  }
  const viewNames = sanitizeViewNames(isRecord(value.app) ? value.app.view_names : undefined);
  if (viewNames) safe.app = { ...(isRecord(safe.app) ? safe.app : {}), view_names: viewNames };
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function readTransactionSource(value: unknown): unknown {
  return isRecord(value) ? value.source : undefined;
}

function readSafeTraceField(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value);
}

function isValidHexId(value: unknown, length: number): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value) &&
    !/^0+$/.test(value)
  );
}

const SAFE_MEASUREMENTS: Record<string, string> = {
  app_start_cold: 'millisecond',
  app_start_warm: 'millisecond',
  frames_total: 'none',
  frames_slow: 'none',
  frames_frozen: 'none',
};

function sanitizeMeasurements(value: unknown): TransactionEvent['measurements'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const safe: Record<string, { value: number; unit: string }> = {};
  for (const [name, unit] of Object.entries(SAFE_MEASUREMENTS)) {
    const measurement = (value as Record<string, unknown>)[name];
    if (!measurement || typeof measurement !== 'object') continue;
    const numericValue = (measurement as Record<string, unknown>).value;
    if (typeof numericValue !== 'number' || !Number.isFinite(numericValue) || numericValue < 0) continue;
    safe[name] = { value: numericValue, unit };
  }
  return Object.keys(safe).length > 0
    ? (safe as TransactionEvent['measurements'])
    : undefined;
}

function sanitizeAutomaticTransaction(
  event: TransactionEvent,
): TransactionEvent {
  const safe: TransactionEvent = {
    ...sanitizeAutomaticBaseEvent(event),
    type: 'transaction',
  };
  safe.transaction = sanitizeEventTransactionName(
    event.transaction,
    readTransactionSource(event.transaction_info),
  );
  safe.spans = (event.spans ?? [])
    .filter(hasValidSpanIds)
    .map(sanitizeAutomaticSpan);
  const measurements = sanitizeMeasurements(event.measurements);
  if (measurements) safe.measurements = measurements;
  if (event.transaction_info?.source) {
    safe.transaction_info = { source: event.transaction_info.source };
  }
  return safe;
}

function toSafeError(error: unknown, safeMessage: string): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const errorLike = error as { message?: unknown; name?: unknown; stack?: unknown };
    const safeError = new Error(safeMessage);
    const candidateName =
      typeof errorLike.name === 'string' ? errorLike.name : 'Error';
    safeError.name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidateName)
      ? candidateName
      : 'Error';
    if (typeof errorLike.stack === 'string') {
      const stackLines = sanitizeStringForSentry(errorLike.stack).split('\n');
      safeError.stack = [
        `${safeError.name}: ${safeMessage}`,
        ...stackLines.slice(1),
      ].join('\n');
    }
    return safeError;
  }

  return new Error(safeMessage);
}

/** 只将已知故障翻译成固定说明，绝不回传任意 error.message。 */
function errorExplanation(error: unknown, context?: Record<string, unknown>): string {
  const source = isRecord(error) ? error : {};
  const message = typeof source.message === 'string' ? source.message : '';
  const releasedExplanation = '原生资源已释放或不可用';
  if ([
    'Unable to find the native shared object',
    'Cannot use shared object that was already released',
    'NativeSharedObjectNotFoundException',
    releasedExplanation,
  ].some(part => message.includes(part))) return releasedExplanation;
  if (context?.failureKind === 'timeout') return '请求超时';
  if (context?.failureKind === 'network') return '网络连接失败';
  if (context?.failureKind === 'invalid-json') return '服务端响应格式无法解析';
  switch (source.name) {
    case 'ResponseShapeError': return '服务端返回的数据结构不符合预期';
    case 'TypeError': return '类型错误：调用或数据类型不符合预期';
    case 'ReferenceError': return '引用错误：访问了未定义的变量';
    case 'RangeError': return '数值或调用深度超出限制';
    case 'SyntaxError': return '代码或数据格式无法解析';
    default: return '运行时错误（原始文本已隐藏）';
  }
}

/** 共享同一套安全格式，给接口错误、自动 HTTP 面包屑和本地诊断使用。 */
function requestSummary(label: string, details: Record<string, unknown>): string {
  const parts = [label];
  const method = typeof details.method === 'string' && isSafeDiagnosticDetail('method', details.method)
    ? details.method : '';
  const endpoint = typeof details.endpointPath === 'string' ? safeHttpEndpoint(details.endpointPath) : '';
  if (method || endpoint) parts.push(`${method} ${endpoint}`.trim());
  const status = typeof details.status === 'string' && /^\d{1,3}$/.test(details.status)
    ? Number(details.status) : details.status;
  if (isSafeDiagnosticDetail('status', status)) parts.push(status === 0 ? '未收到响应' : `HTTP ${status}`);
  if (isSafeDiagnosticDetail('durationMs', details.durationMs)) parts.push(`${details.durationMs} ms`);
  return parts.join('｜');
}

function safeErrorMessage(context: Record<string, unknown> | undefined, error?: unknown): string {
  const explanation = errorExplanation(error, context);
  if (context?.operation === 'render' && context.kind === 'route') {
    return `页面显示或退出失败｜${explanation}`;
  }
  if (context && readTagValue(context, 'endpointPath')) {
    return `${requestSummary('接口请求失败', context)}｜${explanation}`;
  }
  const operation = context ? readTagValue(context, 'operation') : undefined;
  if (operation && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(operation)) {
    const component = readTagValue(context ?? {}, 'component');
    const prefix = component && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(component) ? `${component}.` : '';
    return `${prefix}${operation} 失败｜${explanation}`;
  }
  return `应用异常｜${explanation}`;
}

function readTagValue(context: Record<string, unknown>, key: string): string | undefined {
  const value = context[key];
  if (typeof value === 'string') {
    const sanitized = sanitizeStringForSentry(value).trim();
    return sanitized.length > 0 ? sanitized : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function buildCaptureContext(
  safeContext: Record<string, unknown> | undefined,
  breadcrumbs: readonly DiagnosticBreadcrumb[],
): SentryCaptureContext {
  const hasBreadcrumbs = breadcrumbs.length > 0;

  const tagKeys = [
    'endpointPath',
    'method',
    'status',
    'apiCode',
    'failureKind',
    'component',
    'operation',
    'kind',
    'traceId',
    'requestId',
    'code',
    'storageCode',
    'currentRoute',
    'previousRoute',
    ...STALL_DIAGNOSTIC_TAG_KEYS,
  ];
  const tags = tagKeys.reduce<Record<string, string>>((nextTags, key) => {
    const value = safeContext ? readTagValue(safeContext, key) : undefined;
    return value ? { ...nextTags, [key]: value } : nextTags;
  }, {});

  // 诊断面包屑作为「这次上报」的附加上下文。它不是独立事件：没有 captureException
  // 就没有这段数据。clientDiagnostics 再过一遍 sanitizeContextForSentry，与 context
  // 同一套值级规则（第三层）。
  const extra: Record<string, unknown> = { ...safeContext };
  if (hasBreadcrumbs) {
    extra.clientDiagnostics = sanitizeContextForSentry(breadcrumbs);
  }
  const history = sanitizeNavigationHistory(navigationHistory);
  if (history) extra.navigationHistory = history;

  const captureContext: SentryCaptureContext = {
    // Scope.update 不接受 null；显式 id: undefined 才能覆盖此前账号的 scope。
    user: { id: sentryUserId ?? undefined },
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  if (Object.keys(tags).length > 0) {
    captureContext.tags = tags;
  }
  if (tags.operation === 'render' && tags.kind === 'route') {
    // 页面异常仍按原始堆栈分组，避免所有页面、所有根因挤进同一个 render/route issue。
    captureContext.fingerprint = ['{{ default }}', 'route-render'];
  } else if (tags.endpointPath && tags.method) {
    captureContext.fingerprint = [
      'api',
      tags.method,
      tags.endpointPath,
      tags.status ?? 'unknown-status',
      tags.apiCode ?? 'no-api-code',
      tags.failureKind ?? 'http',
      // 卡顿救回来（用户无感）与重试也失败（用户看到报错）各成一个 issue，计数与告警不混。
      ...(tags.retry ? [tags.retry] : []),
    ];
  } else if (tags.operation) {
    // 非 API 失败（如 upload）：error.message 已本地化，若沿用 Sentry 默认按消息分组，
    // 同一故障会按语言碎成多个 issue。用稳定的 operation + kind 组 fingerprint。
    // 错误码不同就是不同的故障（发消息 ack 超时 vs 非法载荷；存储 AccessDenied 签名
    // 问题 vs SlowDown 限流），各自成 issue。
    captureContext.fingerprint = [
      tags.operation,
      tags.kind ?? 'unknown-kind',
      tags.failureKind ?? 'error',
      ...(tags.code ? [tags.code] : []),
      ...(tags.storageCode ? [tags.storageCode] : []),
    ];
  }
  return captureContext;
}

/**
 * 面包屑是「装饰」这次上报的附加信息，绝不能反过来把上报本身弄丢：reportError 整体
 * 包在 try/catch 里（且是静默的），一旦读面包屑抛异常，就会连 captureException 一起
 * 吞掉——错误上报静默消失，比没有面包屑严重得多。所以单独兜一层，失败就退化成无面包屑。
 */
function safeReadBreadcrumbs(): readonly DiagnosticBreadcrumb[] {
  try {
    return readDiagnosticBreadcrumbs() ?? [];
  } catch {
    return [];
  }
}

/**
 * Reports a handled ("soft failure") error to Sentry — errors that are caught
 * and recovered, so Sentry's automatic handlers never see them. No-op when
 * Sentry is not initialized. `client` is injectable for tests.
 *
 * 这里是 client diagnostics 面包屑离开设备的唯一时机：面包屑只作为「本来就要发的
 * 这条错误」的附加上下文搭车，不构成独立事件。Sentry 没被 init / 这次不报错 →
 * 面包屑一个字节都不出去。见 utils/client-diagnostics 的白名单说明。
 */
export function reportError(
  error: unknown,
  context?: ReportErrorContext,
  client: Pick<typeof Sentry, 'captureException'> = Sentry,
): void {
  if (!sentryInitialized && client === Sentry) {
    return;
  }

  try {
    const sanitizedContext = sanitizeReportContext({ ...routeContext, ...context });
    const safeContext =
      sanitizedContext && Object.keys(sanitizedContext).length > 0
        ? sanitizedContext
        : undefined;
    client.captureException(
      toSafeError(error, safeErrorMessage(safeContext, error)),
      buildCaptureContext(safeContext, safeReadBreadcrumbs()),
    );
  } catch {
    // Observability must never change app behavior.
  }
}

/**
 * Whether an HTTP/network failure is worth reporting: network errors (status 0)
 * and server errors (5xx) are; expected 4xx client/auth/validation errors are
 * not. An unknown status (non-HTTP error) is reported.
 */
export function shouldReportHttpFailure(status: number | undefined): boolean {
  if (status === undefined) {
    return true;
  }
  return status === 0 || status >= 500;
}
