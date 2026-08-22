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

// Expo 会在 web 导出时把 EXPO_PUBLIC_* 编译进浏览器 bundle。release 导出也必须提供
// 生产级传输配置；否则放行 Node/SSG 会把 localhost 开发回退值永久烘焙进静态产物。
const RELAX_TRANSPORT_CHECKS = IS_DEV_BUILD;

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

/**
 * 额外的媒体来源白名单(逗号分隔的 origin 列表)。
 *
 * 上传契约返回的是独立的 fileUrl —— 对象存储/CDN 完全可以挂在自己的域名下,
 * 与 API 主机名无关。allowPeerMediaUrl 若只认 API 来源,这种部署下每一个
 * 合法媒体地址都会被拒:图片全空、语音放不了、封面消失。
 * 所以把「媒体来源」做成显式配置,而不是假设存储和 API 同域。
 *
 * 仍然只放行明确列出的 origin —— 白名单的意义(挡对端塞进来的追踪信标)不变。
 * 非法条目在这里被丢弃并告警,不会让整份配置失效。
 */
function parseMediaOrigins(raw: string | undefined) {
  if (!raw) return [];
  // 不写类型标注:config 的测试 harness 用正则剥类型,只认得函数签名上的。
  const origins = [];
  for (const entry of raw.split(',')) {
    const candidate = trimTrailingSlash(entry.trim());
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('unsupported protocol');
      }
      if (parsed.username || parsed.password) {
        throw new Error('credentials are not allowed');
      }
      origins.push(parsed.origin);
    } catch {
      console.warn(
        `[config] EXPO_PUBLIC_MEDIA_ORIGINS 忽略非法条目: ${candidate}`,
      );
    }
  }
  return origins;
}

export const MEDIA_ORIGINS = parseMediaOrigins(
  process.env.EXPO_PUBLIC_MEDIA_ORIGINS,
);

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

// 客服账号曾经是这里的编译期常量(EXPO_PUBLIC_SUPPORT_ACCOUNT_ID,默认回退 imAdmin)。
// 已改为后端下发:GET /support/config → supportConfigStore,管理台维护。
// 换客服不再需要重新出包发版,也不会再有「渲染成功、一点就失败」的假账号回退。

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
