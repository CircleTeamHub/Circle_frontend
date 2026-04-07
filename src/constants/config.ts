/**
 * constants/config.ts — 运行时配置常量
 *
 * 所有可配置项均通过 EXPO_PUBLIC_* 环境变量注入；
 * 未设置时使用开发环境默认值（自动探测 Expo Dev Server 的 host）。
 *
 * 生产环境必须在 .env.production 或 EAS Build 环境变量中显式设置：
 *   EXPO_PUBLIC_API_URL、EXPO_PUBLIC_OPENIM_API_URL、EXPO_PUBLIC_OPENIM_WS_URL
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = '3000';
const OPENIM_API_PORT = '10002';
const OPENIM_WS_PORT = '10001';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function getExpoDevHost() {
  return Constants.expoConfig?.hostUri?.split(':')[0] ?? null;
}

function getDefaultHost() {
  const expoDevHost = getExpoDevHost();

  if (expoDevHost) {
    return expoDevHost;
  }

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }

  return 'localhost';
}

function getDefaultApiUrl() {
  return `http://${getDefaultHost()}:${API_PORT}`;
}

function getDefaultOpenIMApiUrl() {
  return `http://${getDefaultHost()}:${OPENIM_API_PORT}`;
}

function getDefaultOpenIMWsUrl() {
  return `ws://${getDefaultHost()}:${OPENIM_WS_PORT}`;
}

export const API_URL = trimTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ?? getDefaultApiUrl()
);

export const OPENIM_API_URL = trimTrailingSlash(
  process.env.EXPO_PUBLIC_OPENIM_API_URL ?? getDefaultOpenIMApiUrl()
);

export const OPENIM_WS_URL = trimTrailingSlash(
  process.env.EXPO_PUBLIC_OPENIM_WS_URL ?? getDefaultOpenIMWsUrl()
);

// OpenIM SDK 日志级别：0=关闭 1=fatal 2=error 3=warn 4=info 5=debug
// 默认 3（warn），开发时可在 .env.local 中设置 EXPO_PUBLIC_OPENIM_LOG_LEVEL=5 开启详细日志
export const OPENIM_LOG_LEVEL = Number(
  process.env.EXPO_PUBLIC_OPENIM_LOG_LEVEL ?? 3
);

export const APP_NAME = 'Circle IM';

export const LIMITS = {
  POST_MAX_LENGTH: 5000,
  POST_MAX_IMAGES: 9,
  POST_MAX_VIDEOS: 1,
  IMAGE_MAX_SIZE_MB: 50,
  VIDEO_MAX_SIZE_MB: 500,
  FILE_MAX_SIZE_MB: 2048,
  GROUP_MAX_MEMBERS: 500,
  MESSAGE_RECALL_SECONDS: 120,
} as const;
