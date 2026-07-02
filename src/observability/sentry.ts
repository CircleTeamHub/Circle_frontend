// Sentry wiring for crash / error reporting. Kept as a small, injectable module
// so the gating logic is unit-testable and the root layout stays declarative.
//
// Dormant by default: Sentry only initializes when a DSN is configured via the
// EXPO_PUBLIC_SENTRY_DSN build-time env var or expo config `extra.sentryDsn`.
// With no DSN it is a complete no-op — nothing is sent and nothing crashes.
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

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
const SENSITIVE_CONTEXT_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
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
): SentryCaptureContext | undefined {
  if (!safeContext) return undefined;

  const tagKeys = ['endpointPath', 'method', 'status', 'apiCode', 'failureKind'];
  const tags = tagKeys.reduce<Record<string, string>>((nextTags, key) => {
    const value = readTagValue(safeContext, key);
    return value ? { ...nextTags, [key]: value } : nextTags;
  }, {});

  const captureContext: SentryCaptureContext = { extra: safeContext };
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
  }
  return captureContext;
}

/**
 * Reports a handled ("soft failure") error to Sentry — errors that are caught
 * and recovered, so Sentry's automatic handlers never see them. No-op when
 * Sentry is not initialized. `client` is injectable for tests.
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
    client.captureException(toSafeError(error), buildCaptureContext(safeContext));
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
