import { Platform } from 'react-native';
import Constants from 'expo-constants';

type JPushNotification = {
  notificationEventType?: 'notificationArrived' | 'notificationOpened';
  messageID?: string;
  title?: string;
  content?: string;
  extras?: Record<string, unknown> | string;
  [key: string]: unknown;
};

type JPushModule = {
  setLoggerEnable?: (enabled: boolean) => void;
  init: (options: { appKey: string; channel: string; production: boolean }) => void;
  getRegistrationID: (callback: (result: { registerID?: string }) => void) => void;
  addNotificationListener: (callback: (event: JPushNotification) => void) => void;
  addConnectEventListener?: (callback: (event: { connectEnable?: boolean }) => void) => void;
  setAlias: (params: { sequence: number; alias: string }) => void;
  deleteAlias: (params: { sequence: number }) => void;
  addTagAliasListener?: (callback: (result: { sequence?: number; code?: number }) => void) => void;
  removeListener?: (callback: Function) => void;
  requestPermission?: (options: {
    alert: boolean;
    badge: boolean;
    sound: boolean;
  }) => void;
  resumePush?: () => void;
  setBackgroundEnable?: (enabled: boolean) => void;
};

const REGISTRATION_ID_RETRY_INTERVAL_MS = 5_000;
const REGISTRATION_ID_MAX_WAIT_MS = 60_000;

declare const require: ((specifier: string) => unknown) | undefined;

const listeners = new Set<(event: JPushNotification) => void>();
const connectionListeners = new Set<() => void>();
let moduleInstance: JPushModule | null | undefined;
let initialized = false;
let sequence = 0;

function getModule(): JPushModule | null {
  if (moduleInstance !== undefined) return moduleInstance;
  try {
    if (typeof require !== 'function') return (moduleInstance = null);
    moduleInstance = require('jpush-react-native') as JPushModule;
  } catch {
    moduleInstance = null;
  }
  return moduleInstance;
}

function getAppKey() {
  const config = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  return (
    config?.EXPO_PUBLIC_JPUSH_APP_KEY?.trim() ??
    String((Constants.expoConfig?.extra as { jpushAppKey?: unknown } | undefined)?.jpushAppKey ?? '').trim()
  );
}

function getProductionEnvironment() {
  const configured = (Constants.expoConfig?.extra as
    | { jpushProduction?: unknown }
    | undefined)?.jpushProduction;
  return typeof configured === 'boolean' ? configured : !__DEV__;
}

export function isJPushConfigured() {
  return Platform.OS !== 'web' && Boolean(getAppKey()) && Boolean(getModule());
}

export function initializeJPush() {
  const jpush = getModule();
  const appKey = getAppKey();
  if (!jpush || !appKey || initialized) return Boolean(jpush && appKey);

  jpush.setLoggerEnable?.(__DEV__);
  jpush.init({
    appKey,
    channel: 'windnote',
    production: getProductionEnvironment(),
  });
  jpush.setBackgroundEnable?.(true);
  jpush.addNotificationListener((event) => {
    for (const listener of listeners) listener(event);
  });
  jpush.addConnectEventListener?.((event) => {
    if (!event.connectEnable) return;
    for (const listener of connectionListeners) listener();
  });
  initialized = true;
  return true;
}

/** Re-run token registration when JPush reconnects after the initial wait. */
export function subscribeJPushConnection(listener: () => void) {
  connectionListeners.add(listener);
  initializeJPush();
  return () => {
    connectionListeners.delete(listener);
  };
}

export function subscribeJPush(listener: (event: JPushNotification) => void) {
  listeners.add(listener);
  initializeJPush();
  return () => listeners.delete(listener);
}

export function requestJPushPermission() {
  initializeJPush();
  getModule()?.requestPermission?.({ alert: true, badge: true, sound: true });
}

export function getJPushRegistrationId(): Promise<string> {
  initializeJPush();
  const jpush = getModule();
  if (!jpush) return Promise.resolve('');
  return new Promise((resolve) => {
    let settled = false;
    let retryHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + REGISTRATION_ID_MAX_WAIT_MS;
    const finish = (registrationId: string) => {
      if (settled) return;
      settled = true;
      if (retryHandle) clearTimeout(retryHandle);
      if (jpush.removeListener) jpush.removeListener(onConnect);
      resolve(registrationId);
    };
    const scheduleRetry = () => {
      if (settled || retryHandle) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return finish('');
      retryHandle = setTimeout(() => {
        retryHandle = undefined;
        readRegistrationId();
      }, Math.min(REGISTRATION_ID_RETRY_INTERVAL_MS, remaining));
    };
    const readRegistrationId = () => {
      jpush.getRegistrationID((result) => {
        const registrationId = result.registerID?.trim() ?? '';
        if (registrationId || !jpush.addConnectEventListener) {
          finish(registrationId);
        } else {
          scheduleRetry();
        }
      });
    };
    const onConnect = (event: { connectEnable?: boolean }) => {
      if (event.connectEnable) readRegistrationId();
    };
    if (jpush.addConnectEventListener) {
      jpush.addConnectEventListener(onConnect);
    }
    readRegistrationId();
  });
}

function runAliasOperation(
  operation: (value: { sequence: number }) => void,
): Promise<void> {
  initializeJPush();
  const jpush = getModule();
  if (!jpush) return Promise.resolve();
  const operationSequence = ++sequence;
  return new Promise((resolve, reject) => {
    const listener = (result: { sequence?: number; code?: number }) => {
      if (result.sequence !== operationSequence) return;
      jpush.removeListener?.(listener);
      if ((result.code ?? 0) === 0) resolve();
      else reject(new Error(`JPush alias operation failed: ${result.code}`));
    };
    jpush.addTagAliasListener?.(listener);
    try {
      operation({ sequence: operationSequence });
    } catch (error) {
      reject(error);
    }
  });
}

export function setJPushAlias(alias: string) {
  const jpush = getModule();
  if (!jpush) return Promise.resolve();
  return runAliasOperation((params) => jpush.setAlias({ ...params, alias }));
}

export function deleteJPushAlias() {
  const jpush = getModule();
  if (!jpush) return Promise.resolve();
  return runAliasOperation((params) => jpush.deleteAlias(params));
}

export type { JPushNotification };
