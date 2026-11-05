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
import { createHttpRequestId, diagnosticNow, safeHttpEndpoint, safeHttpRequestId } from '@/observability/http-diagnostics';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { recordSessionDiagnostic, type SessionDiagnosticContext } from '@/observability/session-diagnostics';
import { ApiError } from './api-error';

// 定义搬去 api-error.ts（零依赖），这里原样 re-export 保住既有导入路径。
export { ApiError };

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  retryOnAuthError?: boolean;
  accessToken?: string | null;
  /** @deprecated Bodies are never logged; retained for caller compatibility. */
  logResponseBody?: boolean;
  /**
   * 成功响应的响应头(分页信号 X-Has-More / X-Next-Cursor 只走头)。只在 2xx 时回调;
   * 网页端跨域读不到后端没有在 CORS exposedHeaders 里放行的头。
   */
  onResponseHeaders?: (headers: Headers) => void;
};

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
  // 后端稳定错误码(仅错误信封携带);前端据此映射本地化文案,见 services/api/errors.ts。
  errorCode?: string;
};

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
// Keep outage bursts from exhausting error quotas. Every attempt still leaves
// a local breadcrumb; a different failure shape has a separate budget.
const lastFailureReports = new Map<string, number>();
const FAILURE_REPORT_WINDOW_MS = 60_000;
const MAX_FAILURE_REPORT_KEYS = 100;

function shouldCaptureFailure(key: string): boolean {
  const now = diagnosticNow();
  for (const [entry, timestamp] of lastFailureReports) {
    if (now - timestamp >= FAILURE_REPORT_WINDOW_MS) lastFailureReports.delete(entry);
  }
  const boundedKey = lastFailureReports.has(key) || lastFailureReports.size < MAX_FAILURE_REPORT_KEYS - 1
    ? key : '__other__';
  const previous = lastFailureReports.get(boundedKey);
  if (previous !== undefined && now - previous < FAILURE_REPORT_WINDOW_MS) return false;
  lastFailureReports.set(boundedKey, now);
  return true;
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

  try {
    console.log(`[api] ${label}`, data);
  } catch {
    // A debug sink must not affect requests or authentication.
  }
}

/**
 * 「服务端明确否认了这份凭证」——只有这种失败才允许销毁本地 session。
 *
 * 401 / 403 是服务端给出的认证结论；2xx 响应异常不能伪装成认证拒绝。
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
  lastFailureReports.clear();
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
// AbortError 只可能来自本文件那个 15s 定时器(RequestOptions 不暴露 signal),
// 而定时器一直活到 body 读完(见 executeRequest),所以 body 读到一半超时会在这里
// reject——归入既有 timeout 分支。
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
          defaultValue: '暂时无法连接，请检查网络后重试',
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
  reportContext: { endpoint: string; method: string },
): Promise<ApiResponse<T> | null> {
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    logApiEvent('body-read-error', {
      endpointPath: safeHttpEndpoint(reportContext.endpoint),
      method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(reportContext.method) ? reportContext.method.toUpperCase() : 'OTHER',
      status: res.status,
      failureKind: isAbortError(error) ? 'timeout' : 'body-read',
    });
    throw bodyReadError(error, reportContext);
  }

  logApiEvent('response', {
    status: res.status,
    ok: res.ok,
    body: '[REDACTED]',
  });

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      i18n.t('common.errors.invalidServerResponse', {
        defaultValue: '暂时无法完成操作，请稍后重试',
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

// 本机设备 ID 的来源由启动时注册（见 app/_layout）：client 不直接依赖安全存储，
// 测试与 web 桩都不必为它补模块。
type DeviceIdProvider = () => Promise<string | null>;
let deviceIdProvider: DeviceIdProvider | null = null;

export function registerDeviceIdProvider(provider: DeviceIdProvider | null) {
  deviceIdProvider = provider;
}

// 续签时另报安卓的稳定设备 ID：老安装（随机 ID）借此在服务端登记重装后会用的 ID。
let stableDeviceIdProvider: DeviceIdProvider | null = null;

export function registerStableDeviceIdProvider(provider: DeviceIdProvider | null) {
  stableDeviceIdProvider = provider;
}

// 稳定 ID 只是顺带上报（这次没报，下次续签再报），绝不能为它拖住续签：
// 续签是单例，它卡住所有等着 401 重试的请求都跟着挂住。
const STABLE_DEVICE_ID_WAIT_MS = 1_000;

async function readStableDeviceId(): Promise<string | null> {
  if (!stableDeviceIdProvider) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STABLE_DEVICE_ID_WAIT_MS);
  });
  try {
    return await Promise.race([stableDeviceIdProvider().catch(() => null), giveUp]);
  } finally {
    clearTimeout(timer);
  }
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
  const diagnosticSessionEpoch = useAuthStore.getState().sessionEpoch;
  const clientRequestId = createHttpRequestId();
  let requestId = clientRequestId;
  let responseRequestId: string | undefined;
  const startedAt = diagnosticNow();
  let status = 0;
  let failureKind: string | undefined;
  let failure: ApiError | undefined;
  const endpointPath = safeHttpEndpoint(endpoint);
  const diagnosticMethod = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(method) ? method.toUpperCase() : 'OTHER';

  logApiEvent('request', {
    endpointPath,
    method: diagnosticMethod,
    requestId,
    auth,
    hasAccessToken: Boolean(accessToken),
    headers: '[REDACTED]',
    body: '[REDACTED]',
  });

  const serializedBody = body == null ? undefined : serializeRequestBody(body);
  // 每个请求都带本机设备 ID：登录 / 续签据此判断是否受信任设备。
  const controller = new AbortController();
  // 15s 是整个请求的预算:headers + body。定时器必须活到 body 读完为止——
  // 流式 fetch(web)下 fetch 只等到 headers 就 resolve,body 还在传;
  // 若在那时就 clearTimeout,body 读将没有任何上限,卡住的流会永久挂起。
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    let res: Response;
    try {
      const deviceId = deviceIdProvider ? await new Promise<string | null>((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Request timed out'), { name: 'AbortError' }));
        controller.signal.addEventListener('abort', abort, { once: true });
        void deviceIdProvider!().catch(() => null).then(resolve).finally(() => controller.signal.removeEventListener('abort', abort));
      }) : null;
      res = await fetch(url, {
        method,
        headers: {
          // 只有 JSON / urlencoded 才由我们设置 Content-Type；
          // FormData 必须让 fetch 自动加上含 multipart boundary 的头。
          ...(serializedBody?.contentType
            ? { 'Content-Type': serializedBody.contentType }
            : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
          ...Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'x-request-id')),
          'X-Request-Id': requestId,
        },
        ...(serializedBody ? { body: serializedBody.body } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      logApiEvent('network-error', {
        endpointPath,
        method: diagnosticMethod,
        failureKind: isAbortError(error) ? 'timeout' : 'network',
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
          defaultValue: '暂时无法连接，请检查网络后重试',
        }),
        {
          status: 0,
          failureKind: 'network',
          reportEndpoint: endpoint,
          reportMethod: method,
        }
      );
    }

    status = res.status;
    try {
      responseRequestId = safeHttpRequestId(res.headers?.get('X-Request-Id'));
      requestId = responseRequestId ?? clientRequestId;
    } catch {
      // Keep locally generated correlation if a response/header shim misbehaves.
    }

    const payload = await readPayload<T>(
      res,
      { endpoint, method },
    );
    if (!res.ok) failureKind = 'http';
    else if (isWrappedResponse(payload) && payload.code !== 0) failureKind = 'api-code';
    return { res, payload, requestId, clientRequestId, responseRequestId, durationMs: Math.max(0, Math.round(diagnosticNow() - startedAt)) };
  } catch (error) {
    if (error instanceof ApiError) {
      failure = error;
      failureKind = error.failureKind;
      if (status !== undefined && status > 0) error.responseStatus = status;
      status = error.status;
    } else {
      failureKind = 'unexpected';
    }
    throw error;
  } finally {
    clearTimeout(timer);
    const durationMs = Math.max(0, Math.round(diagnosticNow() - startedAt));
    if (failure) {
      failure.requestId = requestId;
      failure.clientRequestId = clientRequestId;
      failure.durationMs = durationMs;
    }
    const details = { endpointPath, method: diagnosticMethod, status, requestId, clientRequestId, durationMs, failureKind };
    logApiEvent('complete', details);
    try {
      if (useAuthStore.getState().sessionEpoch === diagnosticSessionEpoch) {
        logClientDiagnostic(failureKind ? 'api.request.failed' : durationMs >= 2000 ? 'api.request.slow' : 'api.request.completed', details);
      }
    } catch {
      // Breadcrumb storage is optional and must never change the outcome.
    }
  }
}

function unwrapResponse<T>(
  res: Response,
  payload: ApiResponse<T> | null,
  reportContext?: { endpoint: string; method: string; requestId?: string; clientRequestId?: string; durationMs?: number }
): T {
  if (!res.ok) {
    throw new ApiError(
      (payload as { message?: string } | null)?.message ??
        i18n.t('common.errors.requestFailedWithStatus', {
          status: res.status,
          defaultValue: '请求未完成，请稍后重试',
        }),
      {
        status: res.status,
        code: isWrappedResponse(payload) ? payload.code : undefined,
        data: isWrappedResponse(payload) ? payload.data : payload,
        failureKind: 'http',
        reportEndpoint: reportContext?.endpoint,
        reportMethod: reportContext?.method,
        requestId: reportContext?.requestId,
        clientRequestId: reportContext?.clientRequestId,
        durationMs: reportContext?.durationMs,
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
          requestId: reportContext?.requestId,
          clientRequestId: reportContext?.clientRequestId,
          durationMs: reportContext?.durationMs,
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
  if (useAuthStore.getState().refreshUncertain) {
    throw new ApiError(
      i18n.t('common.errors.refreshResponseInvalid', { defaultValue: '暂时无法更新登录状态，请重新登录后再试' }),
      { status: 0, failureKind: 'refresh-response-invalid' },
    );
  }

  let refreshResponseStatus: number | undefined;
  let refreshResponseDetails: SessionDiagnosticContext = {};
  const activeRefreshPromise = (async () => {
    const { refreshToken } = useAuthStore.getState();

    if (!refreshToken) {
      await clearLocalSession(sessionEpoch, { reason: 'refresh-token-missing' });
      throw new ApiError(
        i18n.t('common.errors.sessionExpired', {
          defaultValue: '登录已过期，请重新登录',
        }),
        { status: 401 }
      );
    }

    const stableDeviceId = await readStableDeviceId();
    const { res, payload, requestId, clientRequestId, durationMs } = await executeRequest<{
      accessToken: string;
      refreshToken: string;
    }>(
      '/auth/refresh',
      {
        method: 'POST',
        body: { refreshToken },
        auth: false,
        ...(stableDeviceId
          ? { headers: { 'X-Stable-Device-Id': stableDeviceId } }
          : {}),
      }
    );
    refreshResponseStatus = res.status;
    assertSessionEpoch(sessionEpoch);
    const tokens = unwrapResponse(res, payload, {
      endpoint: '/auth/refresh',
      method: 'POST',
      requestId,
      clientRequestId,
      durationMs,
    });

    if (!isTokenPair(tokens)) {
      const invalid: unknown = tokens;
      const fields = invalid && typeof invalid === 'object'
        ? invalid as Record<string, unknown> : {};
      refreshResponseDetails = {
        responseShape: invalid == null ? 'empty' : Array.isArray(invalid) ? 'array'
          : typeof invalid === 'object' ? 'object' : 'primitive',
        responseHasAccessToken: typeof fields.accessToken === 'string' && fields.accessToken.length > 0,
        responseHasRefreshToken: typeof fields.refreshToken === 'string' && fields.refreshToken.length > 0,
      };
      // This is an unusable response, not a server authentication rejection.
      throw new ApiError(
        i18n.t('common.errors.refreshResponseInvalid', {
          defaultValue: '暂时无法更新登录状态，请重新登录后再试',
        }),
        {
          status: res.status,
          failureKind: 'refresh-response-invalid',
          reportEndpoint: '/auth/refresh',
          reportMethod: 'POST',
          requestId,
          clientRequestId,
          durationMs,
        }
      );
    }

    const currentAuthState = useAuthStore.getState();
    assertSessionEpoch(sessionEpoch);

    currentAuthState.setTokens(tokens);

    return tokens.accessToken;
  })()
    .catch(async (error) => {
      assertSessionEpoch(sessionEpoch);
      const responseStatus = refreshResponseStatus ?? (error instanceof ApiError ? error.responseStatus : undefined);
      if (error instanceof ApiError && responseStatus !== undefined && responseStatus >= 200 && responseStatus < 300) {
        // The server may already have consumed the refresh token. Retain the
        // session, but persistently stop rotation until fresh login credentials.
        const state = useAuthStore.getState();
        const persistence = state.markRefreshUncertain();
        const context: SessionDiagnosticContext = {
          endpointPath: '/auth/refresh', method: 'POST', status: responseStatus,
          requestId: error.requestId, clientRequestId: error.clientRequestId, durationMs: error.durationMs, failureKind: error.failureKind,
          responseShape: 'unknown', ...refreshResponseDetails,
          authenticated: state.isAuthenticated, hasAccessToken: Boolean(state.accessToken),
          hasRefreshToken: Boolean(state.refreshToken), sessionPreserved: true,
        };
        const diagnosticId = recordSessionDiagnostic('refresh-response-invalid', context);
        reportError(new Error('Authentication refresh response invalid'), {
          ...context, diagnosticId, operation: 'session', kind: 'refreshResponseInvalid',
        });
        try {
          await persistence;
        } catch {
          reportError(new Error('Authentication refresh recovery state could not be persisted'), {
            diagnosticId, operation: 'session', kind: 'refreshStatePersist',
          });
        }
        assertSessionEpoch(sessionEpoch);
        throw new ApiError(
          i18n.t('common.errors.refreshResponseInvalid', { defaultValue: '暂时无法更新登录状态，请重新登录后再试' }),
          { status: responseStatus, failureKind: 'refresh-response-invalid',
            reportEndpoint: '/auth/refresh', reportMethod: 'POST', requestId: error.requestId, clientRequestId: error.clientRequestId, durationMs: error.durationMs },
        );
      }
      // 只有服务端明确否认 refresh token 时才清 session。网络 / 超时 / 5xx 一律原样抛出：
      // 登录态保留，singleton 已在 finally 里释放，下一个请求会重新发起刷新。
      if (
        isDefinitiveAuthFailure(error) &&
        useAuthStore.getState().sessionEpoch === sessionEpoch
      ) {
        await clearLocalSession(sessionEpoch, {
          reason: 'refresh-rejected',
          endpointPath: '/auth/refresh',
          method: 'POST',
          status: refreshResponseStatus ?? error.status,
          requestId: error.requestId,
          clientRequestId: error.clientRequestId,
          failureKind: error.failureKind,
          ...refreshResponseDetails,
        });
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

/**
 * 主动刷新 access token(REST 401 之外的入口)。
 *
 * 实时通道(聊天 socket、realtime ws)在 token 到期时会被服务端断开,而服务端主动
 * 断开的连接不会自己重连 —— 只靠「下一次 REST 请求碰巧 401」来刷新的话,停在一个
 * 不发 REST 的页面上就会一直收不到消息。与 401 路径共用单飞与会话世代闸;
 * 刷新失败时的会话清理语义不变(服务端明确否认 refresh token 才清 session)。
 */
export function refreshSessionAccessToken(): Promise<string> {
  return refreshAccessToken(useAuthStore.getState().sessionEpoch);
}

function shouldReportApiFailure(error: unknown, status: number | undefined): boolean {
  // Auth anomalies are captured once at their decision boundary.
  if (error instanceof ApiError && ['refresh-response-invalid', 'auth-retry-response-replayed'].includes(error.failureKind ?? '')) return false;
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
  const diagnosticSessionEpoch = useAuthStore.getState().sessionEpoch;
  const requestSessionEpoch =
    auth && retryOnAuthError ? useAuthStore.getState().sessionEpoch : null;
  try {
    const initialRequest = await executeRequest<T>(endpoint, options);

    // An authenticated current-password check can fail without invalidating the session.
    if (initialRequest.res.status === 401 && auth && retryOnAuthError &&
      (initialRequest.payload as { errorCode?: string } | null)?.errorCode !== 'AUTH_PASSWORD_INCORRECT') {
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

      if (retryRequest.res.status === 401 &&
        (retryRequest.payload as { errorCode?: string } | null)?.errorCode !== 'AUTH_PASSWORD_INCORRECT') {
        assertSessionEpoch(requestSessionEpoch);
        // An old response cannot establish that newly issued credentials failed.
        // Compare actual server UUIDs, never the generated fallback correlation.
        if (initialRequest.responseRequestId && initialRequest.responseRequestId === retryRequest.responseRequestId) {
          const state = useAuthStore.getState();
          const context: SessionDiagnosticContext = {
            endpointPath: safeHttpEndpoint(endpoint), method: options.method ?? 'GET',
            status: 401, failureKind: 'auth-retry-response-replayed',
            initialRequestId: initialRequest.responseRequestId,
            requestId: retryRequest.requestId, clientRequestId: retryRequest.clientRequestId,
            durationMs: retryRequest.durationMs, sessionPreserved: true,
            authenticated: state.isAuthenticated, hasAccessToken: Boolean(state.accessToken),
            hasRefreshToken: Boolean(state.refreshToken),
          };
          const diagnosticId = recordSessionDiagnostic('auth-retry-response-replayed', context);
          reportError(new Error('Authentication retry received a repeated response'), {
            ...context, diagnosticId, operation: 'session', kind: 'authRetryResponseReplayed',
          });
          // No extra business retry: a write may already have reached the server.
          throw new ApiError(
            i18n.t('common.errors.invalidServerResponse', { defaultValue: '服务器返回了无效响应，请稍后重试' }),
            { status: 0, failureKind: 'auth-retry-response-replayed',
              reportEndpoint: endpoint, reportMethod: options.method ?? 'GET',
              requestId: retryRequest.requestId, clientRequestId: retryRequest.clientRequestId,
              durationMs: retryRequest.durationMs },
          );
        }
        // A distinct rejection retains the existing session revocation behavior.
        await clearLocalSession(requestSessionEpoch, {
          reason: 'request-rejected-after-refresh',
          endpointPath: safeHttpEndpoint(endpoint),
          method: options.method ?? 'GET',
          status: retryRequest.res.status,
          requestId: retryRequest.requestId,
          clientRequestId: retryRequest.clientRequestId,
          initialRequestId: initialRequest.responseRequestId,
          failureKind: 'auth-retry-failed',
        });
        // round 3 review：clearLocalSession 的 await 期间用户可能已登入新会话
        //（epoch 前进，clear 对它是 no-op）。此时再抛 auth-retry-failed 会被
        // 调用方当「当前会话已死」处理（登录路由/清理），伤到新会话 ——
        // 改抛 sessionChanged，语义是「这只是旧会话的过期回声」。
        assertSessionEpoch(requestSessionEpoch);
        throw new ApiError(
          i18n.t('common.errors.sessionExpired', {
            defaultValue: '登录已过期，请重新登录',
          }),
          {
            status: 401,
            failureKind: 'auth-retry-failed',
            reportEndpoint: endpoint,
            reportMethod: options.method ?? 'GET',
          }
        );
      }

      const retried = unwrapResponse(retryRequest.res, retryRequest.payload, {
        endpoint,
        method: options.method ?? 'GET',
        requestId: retryRequest.requestId,
        clientRequestId: retryRequest.clientRequestId,
        durationMs: retryRequest.durationMs,
      });
      options.onResponseHeaders?.(retryRequest.res.headers);
      return retried;
    }

    const data = unwrapResponse(initialRequest.res, initialRequest.payload, {
      endpoint,
      method: options.method ?? 'GET',
      requestId: initialRequest.requestId,
      clientRequestId: initialRequest.clientRequestId,
      durationMs: initialRequest.durationMs,
    });
    options.onResponseHeaders?.(initialRequest.res.headers);
    return data;
  } catch (error) {
    // Report unexpected backend failures (network + 5xx) to Sentry; expected
    // 4xx (validation/auth/not-found) are left to normal handling. Behavior is
    // otherwise unchanged — the error is still re-thrown exactly as before.
    const status = error instanceof ApiError ? error.status : undefined;
    if (useAuthStore.getState().sessionEpoch === diagnosticSessionEpoch && shouldReportApiFailure(error, status)) {
      const reportEndpoint =
        error instanceof ApiError ? error.reportEndpoint ?? endpoint : endpoint;
      const reportMethod =
        error instanceof ApiError
          ? error.reportMethod ?? options.method ?? 'GET'
          : options.method ?? 'GET';
      const captureContext = {
        endpointPath: safeHttpEndpoint(reportEndpoint),
        method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(reportMethod) ? reportMethod.toUpperCase() : 'OTHER',
        status,
        ...(error instanceof ApiError ? { requestId: error.requestId, clientRequestId: error.clientRequestId, durationMs: error.durationMs } : {}),
        ...(error instanceof ApiError && typeof error.code === 'number' && Number.isSafeInteger(error.code)
          ? { apiCode: error.code }
          : {}),
        ...(error instanceof ApiError && error.failureKind
          ? { failureKind: error.failureKind }
          : {}),
        ...(error instanceof ApiError && typeof error.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.errorCode)
          ? { errorCode: error.errorCode }
          : {}),
      };
      const signature = [captureContext.endpointPath, captureContext.method, status, captureContext.apiCode, captureContext.failureKind].join(':');
      try {
        if (shouldCaptureFailure(signature)) reportError(error, captureContext);
      } catch {
        // A reporting SDK must not replace the original business error.
      }
    }
    throw error;
  }
}
