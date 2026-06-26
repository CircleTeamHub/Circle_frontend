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
  client.init({
    dsn,
    environment: options.environment ?? (isDev ? 'development' : 'production'),
    // Native crashes + unhandled JS errors are captured by default. Sample a
    // slice of transactions for light performance visibility; full in dev.
    tracesSampleRate: isDev ? 1.0 : 0.2,
    // Never attach PII (IP, cookies, request bodies) by default.
    sendDefaultPii: false,
  });
  return true;
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
