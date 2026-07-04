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
import { APP_DISPLAY_NAME } from './branding';
import { evaluateTransportGuard } from './transport-security';

// 传输安全守卫：release 构建（!__DEV__）禁止明文 http/ws 打到公网 host，避免误配把
// Bearer token / 金额报文走明文。dev 一律放行（本地开发不受影响）；私网 / 本机 host
// 也放行（局域网自托管、模拟器回环联调）；测试期需要明文公网 IP 时，在构建环境设置
// EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT=1 显式放行。
const IS_DEV_BUILD = typeof __DEV__ !== 'undefined' && __DEV__;

// Expo web 静态渲染（SSG）会在 Node 里、以 production 模式执行本模块，但此刻没有运行时
// EXPO_PUBLIC_* 注入。它是构建期产物、不是最终运行时——若在这里 throw 会直接打断
// `expo export --platform web`（CI 的 Web Export 步骤）。因此把 SSG 视作放行上下文：
// 真正的 web 客户端运行时（浏览器，window 存在）与原生运行时仍照常强校验。
const IS_WEB_STATIC_RENDER =
  Platform.OS === 'web' && typeof window === 'undefined';

// dev 或 web-SSG：放宽「缺少必需配置」与「明文传输」两道启动期校验。
const RELAX_TRANSPORT_CHECKS = IS_DEV_BUILD || IS_WEB_STATIC_RENDER;

const ALLOW_INSECURE_TRANSPORT =
  process.env.EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT === '1' ||
  process.env.EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT === 'true';

function assertSecureTransport(rawUrl: string, label: string): string {
  const problem = evaluateTransportGuard(rawUrl, label, {
    isDev: RELAX_TRANSPORT_CHECKS,
    allowInsecure: ALLOW_INSECURE_TRANSPORT,
  });
  if (problem) {
    throw new Error(problem);
  }
  return rawUrl;
}

function getRequiredTransportValue(
  value: string | undefined,
  envName: string,
  developmentFallback: string,
): string {
  const trimmedValue = value?.trim();
  if (trimmedValue) {
    return trimmedValue;
  }
  if (!RELAX_TRANSPORT_CHECKS) {
    throw new Error(
      `[config] 缺少 release 必需配置 ${envName}。请在 .env.production 或 EAS Build 环境变量中显式设置。`,
    );
  }
  return developmentFallback;
}

const API_PORT = '3000';
const OPENIM_API_PORT = '10002';
const OPENIM_WS_PORT = '10001';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function ensureVersionedApiUrl(value: string) {
  const normalized = trimTrailingSlash(value);

  if (normalized.endsWith('/api/v1')) {
    return normalized;
  }

  return `${normalized}/api/v1`;
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

export const API_URL = assertSecureTransport(
  ensureVersionedApiUrl(
    getRequiredTransportValue(
      process.env.EXPO_PUBLIC_API_URL,
      'EXPO_PUBLIC_API_URL',
      getDefaultApiUrl(),
    ),
  ),
  'API_URL',
);

export const OPENIM_API_URL = assertSecureTransport(
  trimTrailingSlash(
    getRequiredTransportValue(
      process.env.EXPO_PUBLIC_OPENIM_API_URL,
      'EXPO_PUBLIC_OPENIM_API_URL',
      getDefaultOpenIMApiUrl(),
    ),
  ),
  'OPENIM_API_URL',
);

export const OPENIM_WS_URL = assertSecureTransport(
  trimTrailingSlash(
    getRequiredTransportValue(
      process.env.EXPO_PUBLIC_OPENIM_WS_URL,
      'EXPO_PUBLIC_OPENIM_WS_URL',
      getDefaultOpenIMWsUrl(),
    ),
  ),
  'OPENIM_WS_URL',
);

/**
 * 从 API_URL 推导 realtime WebSocket URL：复用相同 host:port，把 protocol
 * http → ws、https → wss，丢掉 `/api/v1` 路径，挂上 `/realtime`。
 *
 * 之前的默认值硬编码 `ws://${host}:${API_PORT}/realtime`，在 prod（API_URL 已经是
 * `https://api.example.com/api/v1`）且 EXPO_PUBLIC_REALTIME_WS_URL 未设置时，
 * 会算出 `ws://api.example.com:3000/realtime` —— 协议错、端口错。
 *
 * 解析失败时退回到 dev 风格的默认值，保证一定能产出可执行字符串。
 */
function deriveRealtimeUrlFromApi(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const portPart = url.port ? `:${url.port}` : '';
    return `${wsProtocol}//${url.hostname}${portPart}/realtime`;
  } catch {
    return `ws://${getDefaultHost()}:${API_PORT}/realtime`;
  }
}

export const REALTIME_WS_URL = assertSecureTransport(
  trimTrailingSlash(
    process.env.EXPO_PUBLIC_REALTIME_WS_URL ?? deriveRealtimeUrlFromApi(API_URL),
  ),
  'REALTIME_WS_URL',
);

// OpenIM SDK 日志级别：0=关闭 1=fatal 2=error 3=warn 4=info 5=debug
// 默认 3（warn），开发时可在 .env.local 中设置 EXPO_PUBLIC_OPENIM_LOG_LEVEL=5 开启详细日志。
// 校验 finite + 范围：若环境变量被设置成非数字（"verbose" 等），Number(...) 会得到 NaN，
// 直接传给 initSDK 是 undefined behavior。fallback 到 3 比让 SDK 静默异常更安全。
const RAW_OPENIM_LOG_LEVEL = Number(
  process.env.EXPO_PUBLIC_OPENIM_LOG_LEVEL ?? 3,
);
export const OPENIM_LOG_LEVEL =
  Number.isFinite(RAW_OPENIM_LOG_LEVEL) &&
  RAW_OPENIM_LOG_LEVEL >= 0 &&
  RAW_OPENIM_LOG_LEVEL <= 5
    ? RAW_OPENIM_LOG_LEVEL
    : 3;

export const APP_NAME = APP_DISPLAY_NAME;

export const LIMITS = {
  POST_MAX_LENGTH: 5000,
  POST_MAX_IMAGES: 9,
  POST_MAX_VIDEOS: 1,
  IMAGE_MAX_SIZE_MB: 50,
  VIDEO_MAX_SIZE_MB: 500,
  FILE_MAX_SIZE_MB: 2048,
  GROUP_MAX_MEMBERS: 500,
  MESSAGE_RECALL_SECONDS: 120,
  // 转账积分上限：客户端兜底防止 off-by-orders、Number.MAX_SAFE_INTEGER 溢出等异常输入。
  // 真实业务上限以后端为准；这里仅做 sanity check。
  TRANSFER_MAX_AMOUNT: 1_000_000,
} as const;
