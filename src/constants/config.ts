/**
 * constants/config.ts — 运行时配置常量
 *
 * 所有可配置项均通过 EXPO_PUBLIC_* 环境变量注入；
 * 未设置时使用开发环境默认值（自动探测 Expo Dev Server 的 host）。
 *
 * 生产环境必须在 .env.production 或 EAS Build 环境变量中显式设置：
 *   EXPO_PUBLIC_API_URL
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

/**
 * 自研聊天网关的 origin（socket.io 客户端要的是 http(s) origin，路径经
 * `path` 选项传 /chat-ws，ws 升级由 socket.io 自己处理）。
 * 从 API_URL 剥掉 /api/v1 路径取 origin；解析失败退回 dev 默认值。
 */
function deriveChatOriginFromApi(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return `http://${getDefaultHost()}:${API_PORT}`;
  }
}

export const CHAT_WS_URL = assertSecureTransport(
  trimTrailingSlash(
    process.env.EXPO_PUBLIC_CHAT_WS_URL ?? deriveChatOriginFromApi(API_URL),
  ),
  'CHAT_WS_URL',
);

export const APP_NAME = APP_DISPLAY_NAME;

/**
 * 客服账号：点「客服中心」某个客服类型时，发起单聊的目标 userID(标准 UUID)。
 *
 * 必须在 EAS Build / .env.production 里把 EXPO_PUBLIC_SUPPORT_ACCOUNT_ID 指向一个
 * 真实客服账号,由真人登录接待。历史默认值 `imAdmin` 是 OpenIM 时代的系统账号,
 * 自研栈里不存在 —— 未配置时发起会话会被后端以「用户不存在」拒绝(可控失败,
 * 保留默认值只为让入口在配置前不至于崩溃)。
 */
export const SUPPORT_ACCOUNT_ID =
  process.env.EXPO_PUBLIC_SUPPORT_ACCOUNT_ID?.trim() || 'imAdmin';

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
