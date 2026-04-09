/**
 * api/client.ts — 通用 HTTP 请求客户端
 *
 * 功能：
 * - 自动附加 Bearer token（auth=true 时）
 * - 响应 401 时自动刷新 token 并重试（refreshPromise 单例防并发）
 * - dev 模式下打印请求/响应日志（敏感字段自动脱敏）
 * - 统一错误格式：ApiError（包含 status、code、data）
 */
import { API_URL } from '@/constants/config';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  retryOnAuthError?: boolean;
  accessToken?: string | null;
};

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

// 日志脱敏字段列表：这些字段在 dev 日志中会替换为 [REDACTED]，防止密码/token 泄漏到控制台
const SENSITIVE_KEYS = new Set(['password', 'token', 'accessToken', 'refreshToken', 'imToken']);

function redactSensitiveFields(value: unknown): unknown {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    redacted[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return redacted;
}

function formatLogData(value: unknown) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(redactSensitiveFields(value));
  } catch {
    return '[unserializable]';
  }
}

function logApiEvent(label: string, data: Record<string, unknown>) {
  if (!isDev) {
    return;
  }

  console.log(`[api] ${label}`, data);
}

export class ApiError extends Error {
  status: number;
  code?: number;
  data?: unknown;

  constructor(message: string, status: number, code?: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// token 刷新 Promise 单例：多个并发请求同时 401 时，只发一次 /auth/refresh
let refreshPromise: Promise<string> | null = null;

async function readPayload<T>(res: Response): Promise<ApiResponse<T> | null> {
  const text = await res.text();

  logApiEvent('response', {
    status: res.status,
    ok: res.ok,
    body: text,
  });

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new ApiError('服务返回了无效数据', res.status);
  }
}

function isWrappedResponse<T>(
  payload: ApiResponse<T> | null
): payload is ApiResponse<T> {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'code' in payload &&
      'message' in payload &&
      'data' in payload
  );
}

async function executeRequest<T>(
  endpoint: string,
  options: RequestOptions,
  accessTokenOverride?: string | null
) {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    accessToken: explicitAccessToken,
  } = options;
  const accessToken =
    accessTokenOverride ??
    explicitAccessToken ??
    (auth ? useAuthStore.getState().accessToken : null);
  const url = `${API_URL}${endpoint}`;

  logApiEvent('request', {
    url,
    method,
    auth,
    hasAccessToken: Boolean(accessToken),
    headers,
    body: formatLogData(body),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    logApiEvent('network-error', {
      url,
      method,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('请求超时，请检查网络连接后重试', 0);
    }
    throw new ApiError('网络异常，请确认后端服务已启动', 0);
  } finally {
    clearTimeout(timer);
  }

  const payload = await readPayload<T>(res);

  return { res, payload };
}

function unwrapResponse<T>(res: Response, payload: ApiResponse<T> | null): T {
  if (!res.ok) {
    throw new ApiError(
      (payload as { message?: string } | null)?.message ?? `请求失败 (${res.status})`,
      res.status,
      isWrappedResponse(payload) ? payload.code : undefined,
      isWrappedResponse(payload) ? payload.data : payload
    );
  }

  if (isWrappedResponse(payload)) {
    if (payload.code !== 0) {
      throw new ApiError(
        payload.message || '请求失败',
        res.status,
        payload.code,
        payload.data
      );
    }

    return payload.data;
  }

  return (payload as T | null) ?? (undefined as T);
}

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const { refreshToken, setTokens } = useAuthStore.getState();

    if (!refreshToken) {
      await clearLocalSession();
      throw new ApiError('登录已过期，请重新登录', 401);
    }

    const { res, payload } = await executeRequest<{
      accessToken: string;
      refreshToken: string;
    }>(
      '/auth/refresh',
      {
        method: 'POST',
        body: { refreshToken },
        auth: false,
        retryOnAuthError: false,
      }
    );
    const tokens = unwrapResponse(res, payload);

    setTokens(tokens);

    return tokens.accessToken;
  })()
    .catch(async (error) => {
      await clearLocalSession();
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { auth = true, retryOnAuthError = true } = options;
  const initialRequest = await executeRequest<T>(endpoint, options);

  if (initialRequest.res.status === 401 && auth && retryOnAuthError) {
    const nextAccessToken = await refreshAccessToken();
    const retryRequest = await executeRequest<T>(
      endpoint,
      { ...options, retryOnAuthError: false },
      nextAccessToken
    );

    return unwrapResponse(retryRequest.res, retryRequest.payload);
  }

  return unwrapResponse(initialRequest.res, initialRequest.payload);
}
