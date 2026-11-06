import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { readDiagnosticBreadcrumbs } from '@/utils/client-diagnostics';
import { createHttpRequestId, safeHttpEndpoint, safeHttpRequestId } from './http-diagnostics';

const KEY = 'circle-im-session-diagnostics-v1';
const MAX_RECORDS = 5;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REASONS = [
  'refresh-token-missing', 'refresh-rejected', 'refresh-response-invalid',
  'refresh-outcome-unknown', 'refresh-interrupted',
  'request-rejected-after-refresh', 'auth-retry-response-replayed', 'realtime-revoked', 'bootstrap-rejected',
  'bootstrap-tokens-missing', 'hydration-tokens-invalid', 'hydration-read-failed',
  'startup-storage-failed', 'user-logout', 'account-switch', 'account-switch-rejected',
  'failed-login-cleanup', 'password-change', 'email-change', 'account-cancel',
  'user-session-revoke', 'unspecified-clear',
] as const;
export type SessionDiagnosticReason = typeof REASONS[number];

export interface SessionDiagnosticContext {
  endpointPath?: string;
  method?: string;
  status?: number;
  requestId?: string;
  clientRequestId?: string;
  initialRequestId?: string;
  failureKind?: string;
  durationMs?: number;
  closeCode?: number;
  userInitiated?: boolean;
  authenticated?: boolean;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  responseShape?: string;
  responseHasAccessToken?: boolean;
  responseHasRefreshToken?: boolean;
  sessionPreserved?: boolean;
  stage?: string;
}
interface RequestSnapshot {
  timestamp: number;
  event: string;
  context: SessionDiagnosticContext;
}
export interface SessionDiagnosticRecord {
  id: string;
  timestamp: number;
  platform: string;
  appVersion: string | null;
  buildVersion: string | null;
  reason: SessionDiagnosticReason;
  context: SessionDiagnosticContext;
  requests: RequestSnapshot[];
}

const FAILURE_KINDS = new Set([
  'http', 'api-code', 'invalid-json', 'network', 'timeout', 'body-read',
  'unexpected', 'session-changed', 'auth-retry-failed', 'refresh-response-invalid', 'auth-retry-response-replayed',
  'refresh-outcome-unknown',
]);
const REQUEST_EVENTS = new Set(['api.request.completed', 'api.request.failed', 'api.request.slow']);
let memory: SessionDiagnosticRecord[] = [];
let pendingWrite = Promise.resolve();

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 32 && /^\d+(?:\.\d+){0,3}$/.test(value) ? value : null;
}

// A separate whitelist from general breadcrumbs: no account/chat/device identifiers
// may survive logout in this device-local support record.
function safeContext(value: unknown): SessionDiagnosticContext {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const safe: SessionDiagnosticContext = {};
  if (typeof source.endpointPath === 'string') safe.endpointPath = safeHttpEndpoint(source.endpointPath);
  if (typeof source.method === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(source.method)) safe.method = source.method;
  if (typeof source.status === 'number' && Number.isInteger(source.status) && source.status >= 0 && source.status <= 599) safe.status = source.status;
  for (const key of ['requestId', 'clientRequestId', 'initialRequestId'] as const) {
    const requestId = safeHttpRequestId(source[key]);
    if (requestId) safe[key] = requestId;
  }
  if (typeof source.failureKind === 'string' && FAILURE_KINDS.has(source.failureKind)) safe.failureKind = source.failureKind;
  if (typeof source.durationMs === 'number' && Number.isFinite(source.durationMs) && source.durationMs >= 0) safe.durationMs = source.durationMs;
  if (typeof source.closeCode === 'number' && Number.isInteger(source.closeCode) && source.closeCode >= 1000 && source.closeCode <= 4999) safe.closeCode = source.closeCode;
  if (typeof source.responseShape === 'string' && ['empty', 'object', 'array', 'primitive', 'unknown'].includes(source.responseShape)) safe.responseShape = source.responseShape;
  if (typeof source.stage === 'string' && ['prepare', 'request', 'persist', 'restore'].includes(source.stage)) safe.stage = source.stage;
  for (const key of ['userInitiated', 'authenticated', 'hasAccessToken', 'hasRefreshToken', 'responseHasAccessToken', 'responseHasRefreshToken', 'sessionPreserved'] as const) {
    if (typeof source[key] === 'boolean') safe[key] = source[key];
  }
  return safe;
}

function safeRequests(value: unknown): RequestSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.event !== 'string' || !REQUEST_EVENTS.has(row.event) || typeof row.timestamp !== 'number' || !Number.isFinite(row.timestamp)) return [];
    return [{ timestamp: row.timestamp, event: row.event, context: safeContext(row.context ?? row.details) }];
  });
}

async function loadStored(): Promise<SessionDiagnosticRecord[] | undefined> {
  let serialized: string | null;
  try {
    serialized = await AsyncStorage.getItem(KEY);
  } catch {
    // A failed read is not an empty journal: never overwrite unknown evidence.
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(serialized ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_RECORDS).flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const id = safeHttpRequestId(row.id);
      if (!id || typeof row.timestamp !== 'number' || !Number.isFinite(row.timestamp) ||
          !REASONS.includes(row.reason as SessionDiagnosticReason)) return [];
      return [{ id, timestamp: row.timestamp, reason: row.reason as SessionDiagnosticReason,
        platform: ['android', 'ios', 'web'].includes(row.platform as string) ? row.platform as string : 'other',
        appVersion: safeVersion(row.appVersion), buildVersion: safeVersion(row.buildVersion),
        context: safeContext(row.context), requests: safeRequests(row.requests) }];
    });
  } catch {
    // Malformed persisted input is discarded at this boundary.
    return [];
  }
}

function mergeRecords(stored: SessionDiagnosticRecord[]): SessionDiagnosticRecord[] {
  return [...new Map([...stored, ...memory].map(row => [row.id, row])).values()]
    .filter(row => Date.now() - row.timestamp <= MAX_AGE_MS)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_RECORDS);
}

/** Capture synchronously before cleanup; persist independently of auth/Sentry. */
export function recordSessionDiagnostic(
  reason: SessionDiagnosticReason,
  context: SessionDiagnosticContext = {},
): string {
  const id = createHttpRequestId();
  const record: SessionDiagnosticRecord = {
    id, timestamp: Date.now(), reason,
    platform: ['android', 'ios', 'web'].includes(Platform.OS) ? Platform.OS : 'other',
    appVersion: safeVersion(Application.nativeApplicationVersion),
    buildVersion: safeVersion(Application.nativeBuildVersion),
    context: safeContext(context), requests: safeRequests(readDiagnosticBreadcrumbs()),
  };
  memory = [...memory, record].slice(-MAX_RECORDS);
  pendingWrite = pendingWrite.then(async () => {
    const stored = await loadStored();
    if (!stored) return;
    const records = mergeRecords(stored);
    await AsyncStorage.setItem(KEY, JSON.stringify(records));
  }).catch(() => {
    // No retry loop and no recursive error report; keep the in-memory copy.
  });
  return id;
}

export async function readSessionDiagnostics(): Promise<readonly SessionDiagnosticRecord[]> {
  await pendingWrite;
  return mergeRecords(await loadStored() ?? []);
}
