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
  const release =
    readTrimmed(options.release) ??
    readTrimmed(process.env.EXPO_PUBLIC_SENTRY_RELEASE);
  const dist =
    readTrimmed(options.dist) ?? readTrimmed(process.env.EXPO_PUBLIC_SENTRY_DIST);
  try {
    client.init({
      dsn,
      environment: options.environment ?? (isDev ? 'development' : 'production'),
      ...(release ? { release } : {}),
      ...(dist ? { dist } : {}),
      // Native crashes + unhandled JS errors are captured by default. Keep
      // production tracing conservative; callers can override for targeted QA.
      tracesSampleRate: options.tracesSampleRate ?? (isDev ? 1.0 : 0),
      // Never attach PII (IP, cookies, request bodies) by default.
      sendDefaultPii: false,
      // Manual reportError calls already sanitize their payloads, but native /
      // unhandled SDK events and automatic breadcrumbs bypass that helper.
      beforeSend: sanitizeAutomaticEvent,
      beforeBreadcrumb: sanitizeAutomaticBreadcrumb,
      beforeSendTransaction: sanitizeAutomaticTransaction,
      beforeSendSpan: sanitizeAutomaticSpan,
    });
    sentryInitialized = true;
    return true;
  } catch {
    sentryInitialized = false;
    return false;
  }
}

/** Associates events with an internal account id only; clears it on logout. */
export function setSentryUserId(
  userId: string | null | undefined,
  client: Pick<typeof Sentry, 'setUser'> = Sentry,
): void {
  if (!sentryInitialized && client === Sentry) return;
  try {
    const normalized = readTrimmed(userId);
    client.setUser(normalized ? { id: normalized } : null);
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
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
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
  'email',
  'phone',
  'phonenumber',
  'mobile',
]);
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
  'size',
  'category',
  'agentIndex',
  'source',
  'stage',
  'reason',
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
]);

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
    out[key] = SENSITIVE_CONTEXT_KEYS.has(key.toLowerCase())
      ? '[REDACTED]'
      : sanitizeContextForSentry(child, depth + 1);
  }
  return out;
}

function sanitizeReportContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_REPORT_CONTEXT_KEYS) {
    if (!(key in context)) continue;
    const value = context[key];
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
    if (typeof child === 'string' || typeof child === 'number') {
      safe[key] = sanitizeContextForSentry(child);
    }
  }
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
  if ('transaction' in source) safe.transaction = '[REDACTED_TRANSACTION]';
  const exception = sanitizeException(source.exception);
  if (exception) safe.exception = exception;
  const stacktrace = sanitizeStacktrace(source.stacktrace);
  if (stacktrace) safe.stacktrace = stacktrace;
  const threads = sanitizeThreads(source.threads);
  if (threads) safe.threads = threads;
  const tags = sanitizeEventTags(source.tags);
  if (tags) safe.tags = tags;
  if (source.user && typeof source.user === 'object') {
    const id = (source.user as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) safe.user = { id: id.trim() };
  }
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
  };
}

function sanitizeTraceContext(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.trace_id !== 'string' || typeof source.span_id !== 'string') {
    return undefined;
  }
  return {
    trace_id: source.trace_id,
    span_id: source.span_id,
    data: {},
    ...(typeof source.parent_span_id === 'string'
      ? { parent_span_id: source.parent_span_id }
      : {}),
    ...(typeof source.op === 'string'
      ? { op: sanitizeStringForSentry(source.op) }
      : {}),
    ...(typeof source.origin === 'string'
      ? { origin: sanitizeStringForSentry(source.origin) }
      : {}),
    ...(typeof source.status === 'string'
      ? { status: sanitizeStringForSentry(source.status) }
      : {}),
  };
}

function sanitizeAutomaticTransaction(
  event: TransactionEvent,
): TransactionEvent {
  const safe: TransactionEvent = {
    ...sanitizeAutomaticBaseEvent(event),
    type: 'transaction',
  };
  safe.transaction = '[REDACTED_TRANSACTION]';
  safe.spans = (event.spans ?? []).map(sanitizeAutomaticSpan);
  const trace = sanitizeTraceContext(event.contexts?.trace);
  if (trace) {
    safe.contexts = { trace } as TransactionEvent['contexts'];
  }
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
