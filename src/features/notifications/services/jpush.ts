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
  requestPermission?: () => void;
  resumePush?: () => void;
  setBackgroundEnable?: (enabled: boolean) => void;
};

declare const require: ((specifier: string) => unknown) | undefined;

const listeners = new Set<(event: JPushNotification) => void>();
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
    production: !__DEV__,
  });
  jpush.setBackgroundEnable?.(true);
  jpush.addNotificationListener((event) => {
    for (const listener of listeners) listener(event);
  });
  initialized = true;
  return true;
}

export function subscribeJPush(listener: (event: JPushNotification) => void) {
  listeners.add(listener);
  initializeJPush();
  return () => listeners.delete(listener);
}

export function requestJPushPermission() {
  initializeJPush();
  getModule()?.requestPermission?.();
}

export function getJPushRegistrationId(): Promise<string> {
  initializeJPush();
  const jpush = getModule();
  if (!jpush) return Promise.resolve('');
  return new Promise((resolve) => {
    jpush.getRegistrationID((result) => resolve(result.registerID?.trim() ?? ''));
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
