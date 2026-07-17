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
import { clearLocalSession, registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import i18n from '@/i18n';
import { reportError, shouldReportHttpFailure } from '@/observability/sentry';
import { redactSensitiveFields, redactSensitiveHeaders } from '@/utils/redact';

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
  // 后端稳定错误码(仅错误信封携带);前端据此映射本地化文案,见 services/api/errors.ts。
  errorCode?: string;
};

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

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

// 把响应文本解析为对象再脱敏；解析失败时不直接打印原文（可能是 HTML 错误页或带 token 的字符串）。
function safeBodyTextForLog(text: string): unknown {
  if (!text) return text;
  try {
    return redactSensitiveFields(JSON.parse(text));
  } catch {
    return '[non-json body]';
  }
}

function sanitizeEndpointSegment(segment: string): string {
  if (/^\d+$/.test(segment)) return ':id';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return ':id';
  }
  if (segment.length >= 16 && /[0-9]/.test(segment)) return ':id';
  return segment;
}

function sanitizeEndpointForReport(endpoint: string) {
  try {
    const url = new URL(endpoint, 'https://circle.local');
    const endpointPath = url.pathname
      .split('/')
      .map((segment) => sanitizeEndpointSegment(segment))
      .join('/');
    const queryKeys = Array.from(new Set(url.searchParams.keys())).sort();
    return queryKeys.length > 0 ? { endpointPath, queryKeys } : { endpointPath };
  } catch {
    return { endpointPath: '[invalid-endpoint]' };
  }
}

// 把请求体序列化为 fetch 可接受的形式。
// FormData / URLSearchParams / Blob / ArrayBuffer 不走 JSON.stringify；
// 之前的实现会把 FormData 序列化成 '{}'，让 multipart 上传静默失败。
function serializeRequestBody(
  body: unknown
): { body: BodyInit; contentType?: string } {
  if (body instanceof FormData) return { body }; // boundary 由 fetch 自动设置
  if (body instanceof URLSearchParams) {
    return { body, contentType: 'application/x-www-form-urlencoded' };
  }
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    return { body: body as BodyInit };
  }
  return { body: JSON.stringify(body), contentType: 'application/json' };
}

function isTokenPair(
  value: unknown
): value is { accessToken: string; refreshToken: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    v.accessToken.length > 0 &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken.length > 0
  );
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
  failureKind?: string;
  reportEndpoint?: string;
  reportMethod?: string;
  // 后端稳定错误码(如 AUTH_INVALID_CREDENTIALS);前端据此做 i18n 映射,缺失回落 message。
  errorCode?: string;

  constructor(
    message: string,
    {
      status,
      code,
      data,
      failureKind,
      reportEndpoint,
      reportMethod,
      errorCode,
    }: {
      status: number;
      code?: number;
      data?: unknown;
      failureKind?: string;
      reportEndpoint?: string;
      reportMethod?: string;
      errorCode?: string;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.failureKind = failureKind;
    this.reportEndpoint = reportEndpoint;
    this.reportMethod = reportMethod;
    this.errorCode = errorCode;
  }
}

/**
 * 「服务端明确否认了这份凭证」——只有这种失败才允许销毁本地 session。
 *
 * 401 / 403 是服务端给出的认证结论（含刷新返回体形状异常时我们自己抛的 401）。
 * 而网络不可达 / 超时 / 5xx / 网关脏响应只说明「这一刻够不到服务器」，
 * 把它们也当成登出信号，等于让后端抖一下就把所有在线用户踢下线。
 * session-changed 是本地会话已被换掉（新登录 / 已登出），不是服务端的认证结论。
 */
export function isDefinitiveAuthFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.failureKind === 'session-changed') {
    return false;
  }

  return error.status === 401 || error.status === 403;
}

// token 刷新 Promise 单例：多个并发请求同时 401 时，只发一次 /auth/refresh
let refreshPromise: Promise<string> | null = null;
let refreshPromiseSessionEpoch: number | null = null;

function resetRefreshPromise() {
  refreshPromise = null;
  refreshPromiseSessionEpoch = null;
}

registerLogoutHandler(resetRefreshPromise);

function sessionChangedError() {
  return new ApiError(
    i18n.t('common.errors.sessionChangedDuringRefresh', {
      defaultValue: 'Session changed during token refresh',
    }),
    { status: 401, failureKind: 'session-changed' },
  );
}

function assertSessionEpoch(sessionEpoch: number) {
  if (useAuthStore.getState().sessionEpoch !== sessionEpoch) {
    throw sessionChangedError();
  }
}

// AbortError 在部分运行时是 DOMException,不保证 instanceof Error,按 name 判定。
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

// 响应体读取失败:headers 到了但 body 没读完。fetch 此时已经 resolve,
// executeRequest 里 fetch 的 catch 兜不到,必须在这里转成 ApiError——
// 否则原始 TypeError 带着 status===undefined 逃逸,用户看到未本地化的英文报错。
//
// status 固定 0:body 没读完即传输失败,与 network/timeout 同约定。别改成 res.status——
// shouldReportApiFailure 只给 invalid-json 开了后门,取 res.status 会让 200 上的断流
// 被判成「无需上报」,信号彻底丢掉。
//
// AbortError 只可能来自本文件那个 15s 定时器(RequestOptions 不暴露 signal)。
// 定时器在 fetch resolve 后、readPayload 前就被 clearTimeout 关掉,唯一的缝隙是
// abort() 抢在 fetch resolve 的续延之前执行:body 流已被中断,到 text() 才 reject。
// 那种情况确实是超时,归入既有 timeout 分支。
function bodyReadError(
  error: unknown,
  reportContext: { endpoint: string; method: string }
): ApiError {
  const timedOut = isAbortError(error);
  return new ApiError(
    timedOut
      ? i18n.t('common.errors.requestTimeout', {
          defaultValue: '请求超时，请检查网络连接后重试',
        })
      : i18n.t('common.errors.networkUnavailable', {
          defaultValue: '网络异常，请确认后端服务已启动',
        }),
    {
      status: 0,
      failureKind: timedOut ? 'timeout' : 'body-read',
      reportEndpoint: reportContext.endpoint,
      reportMethod: reportContext.method,
    }
  );
}

async function readPayload<T>(
  res: Response,
  reportContext: { endpoint: string; method: string }
): Promise<ApiResponse<T> | null> {
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    logApiEvent('body-read-error', {
      endpoint: reportContext.endpoint,
      method: reportContext.method,
      status: res.status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw bodyReadError(error, reportContext);
  }

  logApiEvent('response', {
    status: res.status,
    ok: res.ok,
    body: safeBodyTextForLog(text),
  });

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      i18n.t('common.errors.invalidServerResponse', {
        defaultValue: '服务返回了无效数据',
      }),
      {
        status: res.status,
        failureKind: 'invalid-json',
        reportEndpoint: reportContext.endpoint,
        reportMethod: reportContext.method,
      }
    );
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
    headers: redactSensitiveHeaders(headers),
    body: formatLogData(body),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  const serializedBody = body == null ? undefined : serializeRequestBody(body);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        // 只有 JSON / urlencoded 才由我们设置 Content-Type；
        // FormData 必须让 fetch 自动加上含 multipart boundary 的头。
        ...(serializedBody?.contentType
          ? { 'Content-Type': serializedBody.contentType }
          : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(serializedBody ? { body: serializedBody.body } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    logApiEvent('network-error', {
      url,
      method,
      error: error instanceof Error ? error.message : String(error),
    });
    if (isAbortError(error)) {
      throw new ApiError(
        i18n.t('common.errors.requestTimeout', {
          defaultValue: '请求超时，请检查网络连接后重试',
        }),
        {
          status: 0,
          failureKind: 'timeout',
          reportEndpoint: endpoint,
          reportMethod: method,
        }
      );
    }
    throw new ApiError(
      i18n.t('common.errors.networkUnavailable', {
        defaultValue: '网络异常，请确认后端服务已启动',
      }),
      {
        status: 0,
        failureKind: 'network',
        reportEndpoint: endpoint,
        reportMethod: method,
      }
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = await readPayload<T>(res, { endpoint, method });

  return { res, payload };
}

function unwrapResponse<T>(
  res: Response,
  payload: ApiResponse<T> | null,
  reportContext?: { endpoint: string; method: string }
): T {
  if (!res.ok) {
    throw new ApiError(
      (payload as { message?: string } | null)?.message ??
        i18n.t('common.errors.requestFailedWithStatus', {
          status: res.status,
          defaultValue: '请求失败 ({{status}})',
        }),
      {
        status: res.status,
        code: isWrappedResponse(payload) ? payload.code : undefined,
        data: isWrappedResponse(payload) ? payload.data : payload,
        reportEndpoint: reportContext?.endpoint,
        reportMethod: reportContext?.method,
        errorCode: (payload as { errorCode?: string } | null)?.errorCode,
      }
    );
  }

  if (isWrappedResponse(payload)) {
    if (payload.code !== 0) {
      throw new ApiError(
        payload.message ||
          i18n.t('common.errors.requestFailed', { defaultValue: '请求失败' }),
        {
          status: res.status,
          code: payload.code,
          data: payload.data,
          failureKind: 'api-code',
          reportEndpoint: reportContext?.endpoint,
          reportMethod: reportContext?.method,
          errorCode: payload.errorCode,
        }
      );
    }

    return payload.data;
  }

  return (payload as T | null) ?? (undefined as T);
}

async function refreshAccessToken(sessionEpoch: number) {
  if (
    refreshPromise &&
    refreshPromiseSessionEpoch === sessionEpoch
  ) {
    return refreshPromise;
  }

  assertSessionEpoch(sessionEpoch);

  const activeRefreshPromise = (async () => {
    const { refreshToken } = useAuthStore.getState();

    if (!refreshToken) {
      await clearLocalSession(sessionEpoch);
      throw new ApiError(
        i18n.t('common.errors.sessionExpired', {
          defaultValue: '登录已过期，请重新登录',
        }),
        { status: 401 }
      );
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
      }
    );
    const tokens = unwrapResponse(res, payload, {
      endpoint: '/auth/refresh',
      method: 'POST',
    });

    if (!isTokenPair(tokens)) {
      // 后端字段缺失 / 重命名 / 类型异常 — 视为刷新失败，避免后续带着 Bearer undefined 死循环。
      throw new ApiError(
        i18n.t('common.errors.refreshResponseInvalid', {
          defaultValue: '刷新返回数据格式异常，请重新登录',
        }),
        { status: 401 }
      );
    }

    const currentAuthState = useAuthStore.getState();
    assertSessionEpoch(sessionEpoch);

    currentAuthState.setTokens(tokens);

    return tokens.accessToken;
  })()
    .catch(async (error) => {
      // 只有服务端明确否认 refresh token 时才清 session。网络 / 超时 / 5xx 一律原样抛出：
      // 登录态保留，singleton 已在 finally 里释放，下一个请求会重新发起刷新。
      if (
        isDefinitiveAuthFailure(error) &&
        useAuthStore.getState().sessionEpoch === sessionEpoch
      ) {
        await clearLocalSession(sessionEpoch);
      }
      throw error;
    })
    .finally(() => {
      if (refreshPromise === activeRefreshPromise) {
        refreshPromise = null;
        refreshPromiseSessionEpoch = null;
      }
    });

  refreshPromise = activeRefreshPromise;
  refreshPromiseSessionEpoch = sessionEpoch;
  return activeRefreshPromise;
}

function shouldReportApiFailure(error: unknown, status: number | undefined): boolean {
  if (error instanceof ApiError && error.failureKind === 'invalid-json') {
    return true;
  }

  return shouldReportHttpFailure(status);
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { auth = true, retryOnAuthError = true } = options;
  const requestSessionEpoch =
    auth && retryOnAuthError ? useAuthStore.getState().sessionEpoch : null;
  try {
    const initialRequest = await executeRequest<T>(endpoint, options);

    if (initialRequest.res.status === 401 && auth && retryOnAuthError) {
      if (requestSessionEpoch === null) {
        throw sessionChangedError();
      }
      assertSessionEpoch(requestSessionEpoch);
      const nextAccessToken = await refreshAccessToken(requestSessionEpoch);
      assertSessionEpoch(requestSessionEpoch);
      const retryRequest = await executeRequest<T>(
        endpoint,
        { ...options, retryOnAuthError: false },
        nextAccessToken
      );

      return unwrapResponse(retryRequest.res, retryRequest.payload, {
        endpoint,
        method: options.method ?? 'GET',
      });
    }

    return unwrapResponse(initialRequest.res, initialRequest.payload, {
      endpoint,
      method: options.method ?? 'GET',
    });
  } catch (error) {
    // Report unexpected backend failures (network + 5xx) to Sentry; expected
    // 4xx (validation/auth/not-found) are left to normal handling. Behavior is
    // otherwise unchanged — the error is still re-thrown exactly as before.
    const status = error instanceof ApiError ? error.status : undefined;
    if (shouldReportApiFailure(error, status)) {
      const reportEndpoint =
        error instanceof ApiError ? error.reportEndpoint ?? endpoint : endpoint;
      const reportMethod =
        error instanceof ApiError
          ? error.reportMethod ?? options.method ?? 'GET'
          : options.method ?? 'GET';
      reportError(error, {
        ...sanitizeEndpointForReport(reportEndpoint),
        method: reportMethod,
        status,
        ...(error instanceof ApiError && error.code !== undefined
          ? { apiCode: error.code }
          : {}),
        ...(error instanceof ApiError && error.failureKind
          ? { failureKind: error.failureKind }
          : {}),
        ...(error instanceof ApiError && error.errorCode
          ? { errorCode: error.errorCode }
          : {}),
      });
    }
    throw error;
  }
}
