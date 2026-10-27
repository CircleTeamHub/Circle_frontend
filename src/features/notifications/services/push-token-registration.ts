import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  deleteLegacyPushToken,
  registerPushToken,
  revokePushToken,
  type PushTokenPlatform,
  type PushTokenProvider,
  type RegisterPushTokenInput,
} from '@/services/api/notifications';
import { storage } from '@/storage';
import { useAuthStore } from '@/stores/authStore';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { reportHandledFailure } from '@/observability/report-failure';
import { ensureChatNotificationChannel } from '@/chat-core/chat-notifications';
import {
  getJPushRegistrationId,
  initializeJPush,
  requestJPushPermission,
} from '@/features/notifications/services/jpush';
import {
  CALL_PUSH_VERSION,
  supportsCallPush,
} from '@/features/call/push/call-push-native';

type NotificationsModule = typeof import('expo-notifications');
type NotificationPermissionResult = Awaited<
  ReturnType<NotificationsModule['getPermissionsAsync']>
>;

type StoredPushRegistration = {
  token: string;
  userId: string;
  revocationSecret: string;
  status: 'pending' | 'registered';
  deviceBindingVersion?: 1;
  /** 登记时附带字段（来电推送版本等）的指纹：变了就要重新登记一次，哪怕 token 没变。 */
  fingerprint?: string;
};

/** 随 token 一起登记的附加字段：来电推送协议版本、VoIP token 的 APNs 环境。 */
export type PushRegistrationExtras = Pick<
  RegisterPushTokenInput,
  'callPushVersion' | 'apnsEnvironment'
>;

type PushTokenRevocation = Pick<
  StoredPushRegistration,
  'token' | 'revocationSecret'
>;

type LegacyPushRegistration = { token: string; userId: string };
type LegacyPushCleanup = LegacyPushRegistration & { legacy: true };
type PushStateV2 = {
  version: 2;
  active: StoredPushRegistration | LegacyPushRegistration | null;
  tombstones: (PushTokenRevocation | LegacyPushCleanup)[];
};
type RuntimeCrypto = {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
};
type ExpoCryptoModule = { randomUUID?: () => string };

type PushTokenRegistrationOrchestratorDependencies = {
  platform: PushTokenPlatform;
  provider?: PushTokenProvider;
  appVersion: string | null;
  getProjectId: () => string | null;
  getStoredRegistration: () => StoredPushRegistration | null;
  setStoredRegistration: (value: StoredPushRegistration | null) => void;
  getPendingRevocations: () => PushTokenRevocation[];
  setPendingRevocations: (value: PushTokenRevocation[]) => void;
  retireStoredRegistration: () => StoredPushRegistration | null;
  getLegacyRegistration?: () => LegacyPushRegistration | null;
  replaceLegacyRegistration?: (value: StoredPushRegistration) => void;
  retireLegacyRegistration?: () => LegacyPushRegistration | null;
  getLegacyCleanups?: () => LegacyPushCleanup[];
  removeLegacyCleanup?: (value: LegacyPushCleanup) => void;
  generateRevocationSecret: () => string;
  loadNotificationsModule: () => Promise<NotificationsModule | null>;
  /**
   * 自带取 token 的方式（iOS PushKit 的 VoIP token）。不给时按 provider 取极光 / Expo 的。
   */
  getToken?: () => Promise<string>;
  /**
   * 默认 true。VoIP 推送不需要系统通知权限（CallKit 自己响铃），给 false 跳过申请：
   * 用户关了通知也照样能来电。
   */
  requiresNotificationPermission?: boolean;
  getRegistrationExtras?: () =>
    | PushRegistrationExtras
    | Promise<PushRegistrationExtras>;
  /**
   * 请求权限之前准备通知渠道(聊天渠道)。安卓 13 起应用一个渠道都没有时系统不弹
   * 权限框;失败只记诊断,不挡注册 —— 推送会回落到默认渠道。
   */
  prepareNotifications?: (notifications: NotificationsModule) => Promise<void>;
  registerPushToken: typeof registerPushToken;
  revokePushToken: typeof revokePushToken;
  deleteLegacyPushToken?: typeof deleteLegacyPushToken;
  getAccessToken?: () => string | null;
  /** 服务端确认收下了这个账号的 token(登记从 pending 变成 registered)。 */
  onRegistered?: (registration: RegisteredPushToken) => void;
  scheduleRetry?: (callback: () => void, delayMs: number) => unknown;
  cancelRetry?: (handle: unknown) => void;
  now: () => number;
  reportFailure: typeof reportNotificationFailure;
  reportDiagnostic: typeof logClientDiagnostic;
};

const PUSH_REGISTRATION_KEY = 'circle-im-push-registration';
const LEGACY_PUSH_REVOCATIONS_KEY = 'circle-im-push-revocations';
const REVOCATION_BACKPRESSURE_THRESHOLD = 50;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

declare const require:
  | ((specifier: string) => unknown)
  | undefined;

function getProjectId() {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
  };
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string }; projectId?: string }
    | undefined;
  return (
    constants.easConfig?.projectId ??
    extra?.eas?.projectId ??
    extra?.projectId ??
    null
  );
}

function isModernRegistration(value: unknown): value is StoredPushRegistration {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredPushRegistration>;
  return (
    typeof item.token === 'string' &&
    typeof item.userId === 'string' &&
    typeof item.revocationSecret === 'string' &&
    item.revocationSecret.length >= 32 &&
    (item.status === 'pending' || item.status === 'registered')
  );
}

function isLegacyRegistration(value: unknown): value is LegacyPushRegistration {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LegacyPushRegistration>;
  return typeof item.token === 'string' && typeof item.userId === 'string';
}

function readLegacyRevocations(): PushTokenRevocation[] {
  const raw = storage.getString(LEGACY_PUSH_REVOCATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PushTokenRevocation =>
      isModernRegistration({ ...item, userId: 'migration', status: 'pending' }),
    );
  } catch {
    return [];
  }
}

function writePushState(state: PushStateV2) {
  storage.set(PUSH_REGISTRATION_KEY, JSON.stringify(state));
}

export function readPushState(): PushStateV2 {
  const raw = storage.getString(PUSH_REGISTRATION_KEY);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as { version?: unknown }).version === 2
  ) {
    const state = parsed as PushStateV2;
    const active =
      isModernRegistration(state.active) || isLegacyRegistration(state.active)
        ? state.active
        : null;
    const tombstones = Array.isArray(state.tombstones)
      ? state.tombstones.filter(
          (item) =>
            isModernRegistration({ ...item, userId: 'v2', status: 'pending' }) ||
            ((item as LegacyPushCleanup)?.legacy === true &&
              isLegacyRegistration(item)),
        )
      : [];
    const activeIsTombstoned = tombstones.some((item) => {
      if (isModernRegistration(active)) {
        return (
          'revocationSecret' in item &&
          item.token === active.token &&
          item.revocationSecret === active.revocationSecret
        );
      }
      return (
        isLegacyRegistration(active) &&
        'legacy' in item &&
        item.token === active.token &&
        item.userId === active.userId
      );
    });
    const normalized = {
      version: 2 as const,
      active: activeIsTombstoned ? null : active,
      tombstones,
    };
    if (activeIsTombstoned) writePushState(normalized);
    return normalized;
  }
  const active =
    isModernRegistration(parsed) || isLegacyRegistration(parsed) ? parsed : null;
  const migrated: PushStateV2 = {
    version: 2,
    active,
    tombstones: readLegacyRevocations(),
  };
  writePushState(migrated);
  storage.remove(LEGACY_PUSH_REVOCATIONS_KEY);
  return migrated;
}

export type RegisteredPushToken = { userId: string; token: string };

const registeredPushTokenListeners = new Set<
  (registration: RegisteredPushToken) => void
>();

/**
 * 订阅「推送 token 登记确认」。聊天连接握手时要带上本机 token,而首次安装、新账号、
 * token 轮换时,连接常常在登记确认之前就建好了 —— 那条连接要靠这个通知重新握手,
 * 否则服务端一直认不出它是哪台设备。返回取消订阅函数。
 */
export function subscribeRegisteredPushToken(
  listener: (registration: RegisteredPushToken) => void,
): () => void {
  registeredPushTokenListeners.add(listener);
  return () => {
    registeredPushTokenListeners.delete(listener);
  };
}

function notifyRegisteredPushToken(registration: RegisteredPushToken): void {
  for (const listener of [...registeredPushTokenListeners]) {
    try {
      listener(registration);
    } catch (error) {
      reportHandledFailure('notifications', 'registeredTokenListener', error);
    }
  }
}

/**
 * 本机已登记给这个账号、且服务端确认收下了的推送 token。聊天连接握手时带上:这台
 * 设备正开着 App 时,服务端只跳过它的推送(电脑上开着网页版不影响手机)。没有登记、
 * 登记还没确认、或登记的是别的账号时返回 null。
 */
export function getRegisteredPushToken(userId: string): string | null {
  try {
    const active = readPushState().active;
    if (!active || active.userId !== userId) return null;
    if (isModernRegistration(active) && active.status !== 'registered') {
      return null;
    }
    return active.token;
  } catch {
    return null;
  }
}

function getStoredRegistration() {
  const active = readPushState().active;
  return isModernRegistration(active) ? active : null;
}

function setStoredRegistration(value: StoredPushRegistration | null) {
  const state = readPushState();
  writePushState({ ...state, active: value });
}

function getPendingRevocations() {
  return readPushState().tombstones.filter(
    (item): item is PushTokenRevocation => 'revocationSecret' in item,
  );
}

function setPendingRevocations(value: PushTokenRevocation[]) {
  const state = readPushState();
  const legacy = state.tombstones.filter(
    (item): item is LegacyPushCleanup => 'legacy' in item,
  );
  writePushState({ ...state, tombstones: [...legacy, ...value] });
}

export function retireStoredRegistrationAtomically() {
  const state = readPushState();
  if (!isModernRegistration(state.active)) return null;
  const active = state.active;
  const exists = state.tombstones.some(
    (item) =>
      'revocationSecret' in item &&
      item.token === active.token &&
      item.revocationSecret === active.revocationSecret,
  );
  writePushState({
    ...state,
    active: null,
    tombstones: exists ? state.tombstones : [...state.tombstones, active],
  });
  return active;
}

/**
 * 另一份独立的登记状态（同 v2 形状，没有历史迁移）：iOS 的 VoIP token 与极光 / Expo
 * token 是同一台设备上的两个 token，各自登记、各自撤销，不能挤在同一个槽里。
 */
export function createPushRegistrationStore(key: string) {
  type State = { version: 2; active: StoredPushRegistration | null; tombstones: PushTokenRevocation[] };
  const read = (): State => {
    let parsed: unknown = null;
    try {
      const raw = storage.getString(key);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const state = parsed as Partial<State> | null;
    return {
      version: 2,
      active: isModernRegistration(state?.active) ? state!.active! : null,
      tombstones: Array.isArray(state?.tombstones)
        ? state!.tombstones!.filter((item) =>
            isModernRegistration({ ...item, userId: 'v2', status: 'pending' }),
          )
        : [],
    };
  };
  const write = (state: State) => storage.set(key, JSON.stringify(state));
  return {
    getStoredRegistration: () => read().active,
    setStoredRegistration: (value: StoredPushRegistration | null) =>
      write({ ...read(), active: value }),
    getPendingRevocations: () => read().tombstones,
    setPendingRevocations: (value: PushTokenRevocation[]) =>
      write({ ...read(), tombstones: value }),
    retireStoredRegistration: () => {
      const state = read();
      const active = state.active;
      if (!active) return null;
      const exists = state.tombstones.some(
        (item) =>
          item.token === active.token &&
          item.revocationSecret === active.revocationSecret,
      );
      write({
        ...state,
        active: null,
        tombstones: exists
          ? state.tombstones
          : [
              ...state.tombstones,
              { token: active.token, revocationSecret: active.revocationSecret },
            ],
      });
      return active;
    },
  };
}

function getLegacyRegistration() {
  const active = readPushState().active;
  return !isModernRegistration(active) && isLegacyRegistration(active)
    ? active
    : null;
}

function replaceLegacyRegistration(value: StoredPushRegistration) {
  const state = readPushState();
  writePushState({ ...state, active: value });
}

function retireLegacyRegistrationAtomically() {
  const state = readPushState();
  if (isModernRegistration(state.active) || !isLegacyRegistration(state.active)) {
    return null;
  }
  const active = state.active;
  const cleanup: LegacyPushCleanup = { ...active, legacy: true };
  const exists = state.tombstones.some(
    (item) => 'legacy' in item && item.token === active.token && item.userId === active.userId,
  );
  writePushState({
    ...state,
    active: null,
    tombstones: exists ? state.tombstones : [...state.tombstones, cleanup],
  });
  return active;
}

function getLegacyCleanups() {
  return readPushState().tombstones.filter(
    (item): item is LegacyPushCleanup => 'legacy' in item,
  );
}

function removeLegacyCleanup(value: LegacyPushCleanup) {
  const state = readPushState();
  writePushState({
    ...state,
    tombstones: state.tombstones.filter(
      (item) =>
        !(
          'legacy' in item &&
          item.token === value.token &&
          item.userId === value.userId
        ),
    ),
  });
}

function createUuidV4FromBytes(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getRuntimeCrypto() {
  return (
    (globalThis as typeof globalThis & { crypto?: RuntimeCrypto }).crypto ??
    null
  );
}

function generateFallbackRevocationSecret() {
  const runtimeCrypto = getRuntimeCrypto();
  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return runtimeCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof runtimeCrypto?.getRandomValues === 'function') {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    if (!isDev) {
      throw new Error('Secure random source unavailable for push revocation');
    }
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return createUuidV4FromBytes(bytes);
}

export function generateRevocationSecret() {
  try {
    if (typeof require === 'function') {
      const crypto = require('expo-crypto') as ExpoCryptoModule;
      const uuid = crypto.randomUUID?.();
      if (typeof uuid === 'string' && uuid.length >= 32) return uuid;
    }
  } catch (error) {
    reportHandledFailure('notifications', 'expoCryptoUnavailable', error);
  }
  return generateFallbackRevocationSecret();
}

export function createPushTokenRegistrationOrchestrator(
  dependencies: PushTokenRegistrationOrchestratorDependencies,
) {
  type DesiredRegistration =
    | { kind: 'enabled'; owner: number; userId: string }
    | { kind: 'disabled' }
    | { kind: 'signed-out' };

  const permissionAttemptedUserIds = new Set<string>();
  let logoutGateClosed = false;
  let nextOwner = 0;
  let desiredRegistration: DesiredRegistration = { kind: 'signed-out' };
  let mutationTail: Promise<void> = Promise.resolve();
  let flushPromise: Promise<void> | null = null;
  let flushFailures = 0;
  let nextFlushAt = 0;
  let retryHandle: unknown = null;
  let resumeBlockedRegistration: (() => void) | null = null;
  const legacyCleanupInFlight = new Set<string>();

  function enqueueRemoteMutation(operation: () => Promise<void>) {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.catch(() => {});
    return result;
  }

  function revocationKey(value: PushTokenRevocation) {
    return `${value.token}\u0000${value.revocationSecret}`;
  }

  function removePendingRevocation(value: PushTokenRevocation) {
    const key = revocationKey(value);
    dependencies.setPendingRevocations(
      dependencies
        .getPendingRevocations()
        .filter((item) => revocationKey(item) !== key),
    );
  }

  function flushPendingRevocations() {
    if (flushPromise) return flushPromise;
    if (dependencies.now() < nextFlushAt) return Promise.resolve();
    flushPromise = enqueueRemoteMutation(async () => {
      for (const revocation of dependencies.getPendingRevocations()) {
        if (
          !dependencies
            .getPendingRevocations()
            .some((item) => revocationKey(item) === revocationKey(revocation))
        ) {
          continue;
        }
        try {
          await dependencies.revokePushToken(
            revocation.token,
            revocation.revocationSecret,
          );
          removePendingRevocation(revocation);
        } catch (error) {
          dependencies.reportFailure('push_token_revoke_failed', error);
          flushFailures += 1;
          nextFlushAt =
            dependencies.now() + Math.min(60_000, 1_000 * 2 ** (flushFailures - 1));
          if (retryHandle === null && dependencies.scheduleRetry) {
            const delay = nextFlushAt - dependencies.now();
            retryHandle = dependencies.scheduleRetry(() => {
              retryHandle = null;
              void flushPendingRevocations();
            }, delay);
          }
          break;
        }
      }
      if (dependencies.getPendingRevocations().length === 0) {
        flushFailures = 0;
        nextFlushAt = 0;
        if (retryHandle !== null && dependencies.cancelRetry) {
          dependencies.cancelRetry(retryHandle);
          retryHandle = null;
        }
      }
    }).finally(() => {
      flushPromise = null;
      if (
        dependencies.getPendingRevocations().length <
        REVOCATION_BACKPRESSURE_THRESHOLD
      ) {
        const resume = resumeBlockedRegistration;
        resumeBlockedRegistration = null;
        resume?.();
      }
    });
    return flushPromise;
  }

  function flushLegacyCleanups(userId: string | null) {
    if (
      !userId ||
      !dependencies.getLegacyCleanups ||
      !dependencies.removeLegacyCleanup ||
      !dependencies.deleteLegacyPushToken ||
      !dependencies.getAccessToken
    ) {
      return;
    }
    const accessToken = dependencies.getAccessToken();
    if (!accessToken) return;
    for (const cleanup of dependencies.getLegacyCleanups()) {
      if (cleanup.userId !== userId) continue;
      const key = `${cleanup.userId}\u0000${cleanup.token}`;
      if (legacyCleanupInFlight.has(key)) continue;
      legacyCleanupInFlight.add(key);
      void dependencies
        .deleteLegacyPushToken(cleanup.token, { accessToken })
        .then(() => dependencies.removeLegacyCleanup!(cleanup))
        .catch((error) =>
          dependencies.reportFailure('push_token_unregister_failed', error),
        )
        .finally(() => legacyCleanupInFlight.delete(key));
    }
  }

  function retireStoredRegistration() {
    const beforeCount = dependencies.getPendingRevocations().length;
    const stored = dependencies.retireStoredRegistration();
    if (!stored) return;
    const afterCount = dependencies.getPendingRevocations().length;
    if (
      afterCount > beforeCount &&
      beforeCount >= REVOCATION_BACKPRESSURE_THRESHOLD
    ) {
      dependencies.reportDiagnostic('push_token_revocation_queue_saturated', {
        count: afterCount,
        threshold: REVOCATION_BACKPRESSURE_THRESHOLD,
      });
    }
    void flushPendingRevocations();
  }

  /**
   * 两种 provider 都要过系统通知权限:JPush 自己的 requestPermission 只是 iOS
   * 的 APNs 注册,Android 13+ 的 POST_NOTIFICATIONS 运行时权限得由这里申请 ——
   * 否则 JPush ID 照样登记成功,系统却把每一条通知都拦掉。
   * 拿到权限返回通知模块,否则(或期间已过期)返回 null。
   */
  async function ensureNotificationPermission(
    userId: string,
    isStale: () => boolean,
  ): Promise<NotificationsModule | null> {
    const notifications = await dependencies.loadNotificationsModule();
    if (!notifications || isStale()) return null;

    if (dependencies.prepareNotifications) {
      try {
        await dependencies.prepareNotifications(notifications);
      } catch {
        dependencies.reportDiagnostic('push_notification_channels_failed', {
          platform: dependencies.platform,
        });
      }
      if (isStale()) return null;
    }

    let permissions = await notifications.getPermissionsAsync();
    if (isStale()) return null;
    if (!isNotificationGranted(permissions, notifications)) {
      if (
        permissions.canAskAgain === false ||
        permissionAttemptedUserIds.has(userId)
      ) {
        return null;
      }
      permissionAttemptedUserIds.add(userId);
      try {
        permissions = await notifications.requestPermissionsAsync({
          android: {},
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
      } catch (error) {
        permissionAttemptedUserIds.delete(userId);
        throw error;
      }
      if (isStale() || !isNotificationGranted(permissions, notifications)) {
        return null;
      }
    }
    return notifications;
  }

  const orchestrator = {
    flushPendingRevocations,
    logout() {
      resumeBlockedRegistration = null;
      const authenticatedUserId =
        desiredRegistration.kind === 'enabled'
          ? desiredRegistration.userId
          : null;
      logoutGateClosed = true;
      desiredRegistration = { kind: 'signed-out' };
      retireStoredRegistration();
      dependencies.retireLegacyRegistration?.();
      void flushPendingRevocations();
      flushLegacyCleanups(authenticatedUserId);
    },
    async sync(input: {
      isAuthenticated: boolean;
      userId: string;
      pushEnabled: boolean;
      isCancelled?: () => boolean;
    }) {
      void flushPendingRevocations();
      if (!input.isAuthenticated || !input.userId) {
        resumeBlockedRegistration = null;
        desiredRegistration = { kind: 'signed-out' };
        logoutGateClosed = false;
        retireStoredRegistration();
        dependencies.retireLegacyRegistration?.();
        return;
      }
      flushLegacyCleanups(input.userId);
      if (logoutGateClosed || input.isCancelled?.()) return;
      if (!input.pushEnabled) {
        resumeBlockedRegistration = null;
        desiredRegistration = { kind: 'disabled' };
        retireStoredRegistration();
        dependencies.retireLegacyRegistration?.();
        flushLegacyCleanups(input.userId);
        return;
      }
      if (dependencies.platform === 'web') return;
      const owner = ++nextOwner;
      desiredRegistration = { kind: 'enabled', owner, userId: input.userId };
      const storedForAnotherUser = dependencies.getStoredRegistration();
      if (
        storedForAnotherUser &&
        storedForAnotherUser.userId !== input.userId
      ) {
        retireStoredRegistration();
      }
      const legacyForAnotherUser =
        dependencies.getLegacyRegistration?.() ?? null;
      if (
        legacyForAnotherUser &&
        legacyForAnotherUser.userId !== input.userId
      ) {
        dependencies.retireLegacyRegistration?.();
      }
      const pendingRevocationCount = dependencies.getPendingRevocations().length;
      if (
        pendingRevocationCount >= REVOCATION_BACKPRESSURE_THRESHOLD
      ) {
        dependencies.reportDiagnostic('push_token_revocation_backpressure', {
          count: pendingRevocationCount,
          threshold: REVOCATION_BACKPRESSURE_THRESHOLD,
        });
        resumeBlockedRegistration = () => {
          if (
            desiredRegistration.kind === 'enabled' &&
            desiredRegistration.owner === owner
          ) {
            void orchestrator.sync(input);
          }
        };
        return;
      }
      const isCurrentOwner = () =>
        desiredRegistration.kind === 'enabled' &&
        desiredRegistration.owner === owner;
      const isStale = () =>
        !isCurrentOwner() ||
        Boolean(input.isCancelled?.());

      const provider = dependencies.provider ?? 'expo';
      const notifications =
        dependencies.requiresNotificationPermission === false
          ? null
          : await ensureNotificationPermission(input.userId, isStale);
      if (dependencies.requiresNotificationPermission !== false && !notifications) {
        return;
      }
      if (isStale()) return;

      const projectId = dependencies.getProjectId();
      if (provider === 'expo' && !projectId) {
        dependencies.reportDiagnostic('push_token_project_id_missing', {
          platform: dependencies.platform,
        });
        return;
      }

      const legacy = dependencies.getLegacyRegistration?.() ?? null;
      let token = '';
      if (dependencies.getToken) {
        token = await dependencies.getToken();
      } else if (provider === 'jpush') {
        initializeJPush();
        if (dependencies.platform === 'ios') requestJPushPermission();
        token = await getJPushRegistrationId();
      } else if (notifications) {
        const result = await notifications.getExpoPushTokenAsync({ projectId: projectId! });
        token = result.data;
      }
      if (!token || isStale()) return;
      const extras = (await dependencies.getRegistrationExtras?.()) ?? {};
      const fingerprint = JSON.stringify(extras);
      if (isStale()) return;

      if (
        legacy?.userId === input.userId &&
        legacy.token !== token
      ) {
        dependencies.retireLegacyRegistration?.();
        flushLegacyCleanups(input.userId);
      }

      let candidate = dependencies.getStoredRegistration();
      if (
        candidate &&
        dependencies
          .getPendingRevocations()
          .some((item) => revocationKey(item) === revocationKey(candidate!))
      ) {
        dependencies.setStoredRegistration(null);
        candidate = null;
      }
      if (candidate?.token !== token || candidate.userId !== input.userId) {
        retireStoredRegistration();
        candidate = {
          token,
          userId: input.userId,
          revocationSecret: dependencies.generateRevocationSecret(),
          status: 'pending',
          fingerprint,
        };
        if (legacy && dependencies.replaceLegacyRegistration) {
          dependencies.replaceLegacyRegistration(candidate);
        } else {
          dependencies.setStoredRegistration(candidate);
        }
      } else if ((candidate.fingerprint ?? '{}') !== fingerprint) {
        // 同一个 token，附带字段变了（例如升级到支持来电推送的版本）：同一把撤销密钥重新登记。
        candidate = { ...candidate, status: 'pending', fingerprint };
        dependencies.setStoredRegistration(candidate);
      }
      if (candidate.status === 'registered' && candidate.deviceBindingVersion === 1) return;

      const registrationCandidate = candidate;
      await enqueueRemoteMutation(async () => {
        if (!isCurrentOwner() || input.isCancelled?.()) return;

        const activeBefore = dependencies.getStoredRegistration();
        if (
          activeBefore?.token !== registrationCandidate.token ||
          activeBefore.userId !== registrationCandidate.userId ||
          activeBefore.revocationSecret !== registrationCandidate.revocationSecret
        ) {
          return;
        }
        if (activeBefore.status === 'registered' && activeBefore.deviceBindingVersion === 1) return;

        const acknowledgement = await dependencies.registerPushToken({
          token,
          platform: dependencies.platform,
          provider,
          revocationSecret: registrationCandidate.revocationSecret,
          projectId: provider === 'expo' ? projectId : null,
          appVersion: dependencies.appVersion,
          ...extras,
        });

        const currentDesired = desiredRegistration;
        const activeAfter = dependencies.getStoredRegistration();
        if (
          currentDesired.kind === 'enabled' &&
          currentDesired.userId === input.userId &&
          activeAfter?.token === registrationCandidate.token &&
          activeAfter.userId === registrationCandidate.userId &&
          activeAfter.revocationSecret === registrationCandidate.revocationSecret
        ) {
          dependencies.setStoredRegistration({
            ...registrationCandidate,
            status: 'registered',
            ...(acknowledgement?.deviceBound ? { deviceBindingVersion: 1 as const } : {}),
          });
          dependencies.onRegistered?.({
            userId: registrationCandidate.userId,
            token: registrationCandidate.token,
          });
        }
      });
    },
  };
  return orchestrator;
}

function isNotificationGranted(
  result: NotificationPermissionResult,
  notifications: NotificationsModule,
) {
  return Boolean(
    result.granted ||
      result.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL,
  );
}

async function loadNotificationsModule() {
  try {
    return await import('expo-notifications');
  } catch (error) {
    reportHandledFailure('notifications', 'moduleUnavailable', error);
    return null;
  }
}

/**
 * 安卓的极光 token 同时承载来电透传：打过新原生包（有 CallPush 模块）才声明能处理，
 * 否则服务端照旧不给这台设备发来电推送。iOS 的来电走单独登记的 VoIP token。
 */
function defaultRegistrationExtras(
  provider: PushTokenProvider,
): PushRegistrationExtras {
  return Platform.OS === 'android' && provider === 'jpush' && supportsCallPush()
    ? { callPushVersion: CALL_PUSH_VERSION }
    : {};
}

function createDefaultPushTokenRegistrationOrchestrator() {
  const configuredProvider =
    (Constants.expoConfig?.extra as { pushProvider?: unknown } | undefined)
      ?.pushProvider;
  const provider: PushTokenProvider =
    configuredProvider === 'jpush' ? 'jpush' : 'expo';
  return createPushTokenRegistrationOrchestrator({
    platform: Platform.OS as PushTokenPlatform,
    provider,
    getRegistrationExtras: () => defaultRegistrationExtras(provider),
    appVersion: Constants.expoConfig?.version ?? null,
    getProjectId,
    getStoredRegistration,
    setStoredRegistration,
    getPendingRevocations,
    setPendingRevocations,
    retireStoredRegistration: retireStoredRegistrationAtomically,
    getLegacyRegistration,
    replaceLegacyRegistration,
    retireLegacyRegistration: retireLegacyRegistrationAtomically,
    getLegacyCleanups,
    removeLegacyCleanup,
    generateRevocationSecret,
    loadNotificationsModule,
    prepareNotifications: ensureChatNotificationChannel,
    registerPushToken,
    revokePushToken,
    deleteLegacyPushToken,
    getAccessToken: () => useAuthStore.getState().accessToken,
    onRegistered: notifyRegisteredPushToken,
    scheduleRetry: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelRetry: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: Date.now,
    reportFailure: reportNotificationFailure,
    reportDiagnostic: logClientDiagnostic,
  });
}

const SHARED_COORDINATOR_KEY = Symbol.for(
  'circle-im.push-token-registration.coordinator.v2',
);

export function getSharedPushTokenRegistrationOrchestrator() {
  const shared = globalThis as typeof globalThis & {
    [SHARED_COORDINATOR_KEY]?: ReturnType<
      typeof createPushTokenRegistrationOrchestrator
    >;
  };
  shared[SHARED_COORDINATOR_KEY] ??=
    createDefaultPushTokenRegistrationOrchestrator();
  return shared[SHARED_COORDINATOR_KEY];
}

export const pushTokenRegistrationOrchestrator =
  getSharedPushTokenRegistrationOrchestrator();
