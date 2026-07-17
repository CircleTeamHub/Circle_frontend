// Sentry wiring for crash / error reporting. Kept as a small, injectable module
// so the gating logic is unit-testable and the root layout stays declarative.
//
// Dormant by default: Sentry only initializes when a DSN is configured via the
// EXPO_PUBLIC_SENTRY_DSN build-time env var or expo config `extra.sentryDsn`.
// With no DSN it is a complete no-op — nothing is sent and nothing crashes.
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import {
  readDiagnosticBreadcrumbs,
  type DiagnosticBreadcrumb,
} from '@/utils/client-diagnostics';

/** Minimal slice of the Sentry SDK we depend on — lets tests inject a fake. */
export interface SentryLike {
  init: (options: Record<string, unknown>) => void;
  wrap: <P>(component: P) => P;
}

// Adapt the SDK's wider types to our minimal interface at this single boundary.
const defaultClient = Sentry as unknown as SentryLike;
let sentryInitialized = false;

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
  const env = sources.env ?? process.env;
  const extra =
    sources.extra ?? (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? {};

  return readTrimmed(env.EXPO_PUBLIC_SENTRY_DSN) ?? readTrimmed(extra?.sentryDsn);
}

export interface InitSentryOptions {
  client?: SentryLike;
  dsn?: string;
  environment?: string;
  tracesSampleRate?: number;
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
  try {
    client.init({
      dsn,
      environment: options.environment ?? (isDev ? 'development' : 'production'),
      // Native crashes + unhandled JS errors are captured by default. Keep
      // production tracing conservative; callers can override for targeted QA.
      tracesSampleRate: options.tracesSampleRate ?? (isDev ? 1.0 : 0.05),
      // Never attach PII (IP, cookies, request bodies) by default.
      sendDefaultPii: false,
    });
    sentryInitialized = true;
    return true;
  } catch {
    sentryInitialized = false;
    return false;
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
  return enabled ? client.wrap(component) : component;
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
const PRESIGNED_URL_MARKERS = [
  'X-Amz-Algorithm=',
  'X-Amz-Credential=',
  'X-Amz-Signature=',
  'x-id=PutObject',
];
// 这份清单与 utils/redact.ts 的 SENSITIVE_KEYS 是两份独立的表（那份给日志，这份给
// Sentry 上报），已经分叉过一次：redact 有 revocationsecret，这里漏了，而推送撤销密钥
// 正是通知链路的密钥之一。精确匹配的 Set 不会因为有 'secret' 就拦住
// 'revocationsecret'。往任一份加敏感字段时，另一份也要加。
const SENSITIVE_CONTEXT_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'revocationsecret',
  'imtoken',
  'idtoken',
  'apikey',
  'secret',
  'uploadurl',
  'fileurl',
]);

function sanitizeStringForSentry(value: string): string {
  const withoutUrls = value.replace(SENSITIVE_URL_PATTERN, '[REDACTED_URL]');
  return PRESIGNED_URL_MARKERS.some((marker) => withoutUrls.includes(marker))
    ? '[REDACTED]'
    : withoutUrls;
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
    out[key] = SENSITIVE_CONTEXT_KEYS.has(key.toLowerCase())
      ? '[REDACTED]'
      : sanitizeContextForSentry(child, depth + 1);
  }
  return out;
}

function toSafeError(error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const errorLike = error as { message?: unknown; name?: unknown; stack?: unknown };
    const safeError = new Error(
      sanitizeStringForSentry(
        typeof errorLike.message === 'string' ? errorLike.message : String(error),
      ),
    );
    safeError.name = sanitizeStringForSentry(
      typeof errorLike.name === 'string' ? errorLike.name : 'Error',
    );
    if (typeof errorLike.stack === 'string') {
      safeError.stack = sanitizeStringForSentry(errorLike.stack);
    }
    return safeError;
  }

  return new Error(sanitizeStringForSentry(String(error)));
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
    'operation',
    'kind',
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
    captureContext.fingerprint = [
      tags.operation,
      tags.kind ?? 'unknown-kind',
      tags.failureKind ?? 'error',
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
    const safeContext = context
      ? (sanitizeContextForSentry(context) as Record<string, unknown>)
      : undefined;
    client.captureException(
      toSafeError(error),
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
