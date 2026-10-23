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
  ErrorEvent,
  SpanJSON,
  TransactionEvent,
} from '@sentry/core';
import {
  readDiagnosticBreadcrumbs,
  type DiagnosticBreadcrumb,
} from '@/utils/client-diagnostics';
import { isSensitiveFieldKey } from '@/utils/redact';
import { STATIC_ROUTE_SEGMENTS } from './route-segments';
import { TRACED_SPAN_NAMES } from './tracing';

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
      // Never attach PII (IP, cookies, request bodies) by default.
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Native crash capture remains enabled by the SDK default. These JS
      // hooks cannot scrub payload fields emitted only by native crash code.
      // Manual reportError calls already sanitize their payloads, but native /
      // unhandled SDK events and automatic breadcrumbs bypass that helper.
      beforeSend: sanitizeAutomaticEvent,
      beforeBreadcrumb: sanitizeAutomaticBreadcrumb,
      beforeSendTransaction: sanitizeAutomaticTransaction,
      beforeSendSpan: sanitizeAutomaticSpan,
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

/**
 * Sentry is a third party, so never associate an event with our backend account
 * identifier. Clearing the SDK user also handles account switches safely.
 */
export function setSentryUserId(
  _userId: string | null | undefined,
  client: Pick<typeof Sentry, 'setUser'> = Sentry,
): void {
  if (!sentryInitialized && client === Sentry) return;
  try {
    client.setUser(null);
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

function sanitizeException(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const values = (value as Record<string, unknown>).values;
  if (!Array.isArray(values)) return undefined;
  return {
    values: values.map((entry) => {
      if (!entry || typeof entry !== 'object') return {};
      const source = entry as Record<string, unknown>;
      const safe: Record<string, unknown> = {
        value: '[REDACTED_EXCEPTION]',
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
    return [{ event: source.event, details }];
  });
  return safe.length > 0 ? safe : undefined;
}

function isSafeDiagnosticDetail(key: string, value: unknown): boolean {
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
  return Object.keys(safe).length > 0 ? safe : undefined;
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
  if ('message' in source) safe.message = '[REDACTED_EVENT_MESSAGE]';
  if ('transaction' in source) {
    safe.transaction = sanitizeEventTransactionName(
      source.transaction,
      readTransactionSource(source.transaction_info),
    );
  }
  const exception = sanitizeException(source.exception);
  if (exception) safe.exception = exception;
  const stacktrace = sanitizeStacktrace(source.stacktrace);
  if (stacktrace) safe.stacktrace = stacktrace;
  const threads = sanitizeThreads(source.threads);
  if (threads) safe.threads = threads;
  const tags = sanitizeEventTags(source.tags);
  if (tags) safe.tags = tags;
  const extra = sanitizeEventExtra(source.extra);
  if (extra) safe.extra = extra;
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

function sanitizeAutomaticEvent(event: ErrorEvent): ErrorEvent {
  return {
    ...sanitizeAutomaticBaseEvent(event),
    type: undefined,
  };
}

function sanitizeAutomaticBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb;
  const source = breadcrumb as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ['type', 'category', 'level', 'timestamp']) {
    if (key in source) safe[key] = sanitizeContextForSentry(source[key]);
  }
  if ('message' in source) safe.message = '[REDACTED_BREADCRUMB]';
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

function safeErrorMessage(context: Record<string, unknown> | undefined): string {
  const operation = context ? readTagValue(context, 'operation') : undefined;
  if (operation && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(operation)) {
    const kind = readTagValue(context ?? {}, 'kind');
    const safeKind =
      kind && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(kind) ? kind : 'error';
    return `${operation} ${safeKind} failure`;
  }
  if (context && readTagValue(context, 'endpointPath')) {
    return 'api request failure';
  }
  return 'handled application error';
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
): SentryCaptureContext | undefined {
  const hasBreadcrumbs = breadcrumbs.length > 0;
  if (!safeContext && !hasBreadcrumbs) return undefined;

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

  const captureContext: SentryCaptureContext = { extra };
  if (Object.keys(tags).length > 0) {
    captureContext.tags = tags;
  }
  if (tags.endpointPath && tags.method) {
    captureContext.fingerprint = [
      'api',
      tags.method,
      tags.endpointPath,
      tags.status ?? 'unknown-status',
      tags.apiCode ?? 'no-api-code',
      tags.failureKind ?? 'http',
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
    const sanitizedContext = context ? sanitizeReportContext(context) : undefined;
    const safeContext =
      sanitizedContext && Object.keys(sanitizedContext).length > 0
        ? sanitizedContext
        : undefined;
    client.captureException(
      toSafeError(error, safeErrorMessage(safeContext)),
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
