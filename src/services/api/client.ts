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
// AbortError 只可能来自本文件的请求定时器(RequestOptions 不暴露 signal),
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

// 请求的每一段等待都必须自己认中止信号，不能指望下层：RN 的 fetch（whatwg-fetch）在
// XHR 完成时就摘掉了中止监听，之后若 resolve 前出错（状态码 0 时 new Response 在
// setTimeout 里抛错）或 res.text()（Blob → FileReader）挂住，abort 根本叫不停——
// 页面永远转圈，一条超时都不上报。下层本来就会因 abort 而 reject 时，这里赛跑无害。
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  const aborted = () => Object.assign(new Error('Request timed out'), { name: 'AbortError' });
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function readPayload<T>(
  res: Response,
  reportContext: { endpoint: string; method: string },
  signal: AbortSignal,
): Promise<ApiResponse<T> | null> {
  let text: string;
  try {
    text = await untilAborted(res.text(), signal);
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

// 请求诊断钩子：原生端在启动时注册（见 app/_layout、observability/request-trace），
// 记下 XHR 走到哪一步、等待期间 JS 线程卡没卡。client 只拿结果，不碰 XHR 内部。
export type RequestTrace = Readonly<Record<string, string | number | boolean>>;
export type RequestTraceHooks = {
  begin: (requestId: string) => void;
  finish: (requestId: string, failed: boolean) => RequestTrace | undefined;
  /** 响应头已到、body 还在往下走：慢，但没卡死。 */
  isReceiving: (requestId: string) => boolean;
};
let requestTraceHooks: RequestTraceHooks | null = null;

export function registerRequestTraceHooks(hooks: RequestTraceHooks | null) {
  requestTraceHooks = hooks;
}

// 整个请求的预算（headers + body）。
const REQUEST_TIMEOUT_MS = 15_000;
// GET 到这个时刻还「没动静」就判定卡住，换一个新请求：2026-11 实测服务器 30ms 内回了、
// 回包也到了手机，个别请求仍在客户端卡死，同一连接上前后的请求却正常——卡住的那次等满
// 也不会回来，新请求通常立刻成功。响应头已到、body 还在下载的慢请求不算卡住，照常等满
// 整段预算（判断靠 request-trace 钩子；没装钩子的 web 不做这一步）。重试只用剩下的预算，
// 总耗时仍是 REQUEST_TIMEOUT_MS——服务器整个不回包时（冷启动 /auth/me 外面还有一层
// retry）不至于把等待翻倍。
const GET_STALL_CHECK_MS = 8_000;
// 连接被判死（安卓 OkHttp 心跳没回音，见 plugins/with-android-okhttp-health）时，挂在上面的
// 请求直接以 network 失败；GET 换新请求（会走新连接）再试一次，同样只用剩下的预算。
const GET_RETRYABLE_FAILURES: ReadonlySet<string> = new Set(['stalled', 'network']);
// 剩余预算再少也给这么多：刚建一条新连接（TLS 握手 + 一个往返）就要这个量级。
const GET_RETRY_MIN_TIMEOUT_MS = 3_000;

type RequestStage = 'device-id' | 'awaiting-response' | 'reading-body';
// preparedRequestId：续签在发送前已把这个 X-Request-Id 写盘做围栏，必须原样发出。
type RequestBudget = { timeoutMs?: number; stallCheckMs?: number; preparedRequestId?: string };

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
  accessTokenOverride?: string | null,
  { timeoutMs = REQUEST_TIMEOUT_MS, stallCheckMs, preparedRequestId }: RequestBudget = {},
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
  const clientRequestId = preparedRequestId ?? createHttpRequestId();
  let requestId = clientRequestId;
  let responseRequestId: string | undefined;
  // 诊断钩子按「发出去的 X-Request-Id」记账；requestId 之后可能被服务端回显覆盖。
  const traceRequestId = clientRequestId;
  let stage: RequestStage = 'device-id';
  let stalled = false;
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
  // timeoutMs 是整个请求的预算:headers + body。定时器必须活到 body 读完为止——
  // 流式 fetch(web)下 fetch 只等到 headers 就 resolve,body 还在传;
  // 若在那时就 clearTimeout,body 读将没有任何上限,卡住的流会永久挂起。
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 到点还没动静（没收到响应头，或 XHR 已完成却没交到 JS）就提前叫停，交给调用方重试。
  const stallTimer = stallCheckMs === undefined ? undefined : setTimeout(() => {
    try {
      if (!requestTraceHooks || requestTraceHooks.isReceiving(traceRequestId)) return;
    } catch {
      return;
    }
    stalled = true;
    controller.abort();
  }, stallCheckMs);
  try {
    requestTraceHooks?.begin(traceRequestId);
  } catch {
    // Diagnostics must never change the request outcome.
  }

  try {
    let res: Response;
    try {
      const deviceId = deviceIdProvider
        ? await untilAborted(deviceIdProvider().catch(() => null), controller.signal)
        : null;
      stage = 'awaiting-response';
      res = await untilAborted(fetch(url, {
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
      }), controller.signal);
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

    stage = 'reading-body';
    const payload = await readPayload<T>(
      res,
      { endpoint, method },
      controller.signal,
    );
    if (!res.ok) failureKind = 'http';
    else if (isWrappedResponse(payload) && payload.code !== 0) failureKind = 'api-code';
    return { res, payload, requestId, clientRequestId, responseRequestId, durationMs: Math.max(0, Math.round(diagnosticNow() - startedAt)) };
  } catch (error) {
    if (error instanceof ApiError) {
      // 卡顿检查叫停的不是「预算用完」：标成 stalled，apiClient 据此换新请求重试。
      if (stalled && error.failureKind === 'timeout') error.failureKind = 'stalled';
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
    clearTimeout(stallTimer);
    const durationMs = Math.max(0, Math.round(diagnosticNow() - startedAt));
    // 只有传输层失败（status 0：超时 / 断网 / body 断流）才需要「卡在哪」。
    const transportFailure = failure?.status === 0;
    let trace: RequestTrace | undefined;
    try {
      trace = requestTraceHooks?.finish(traceRequestId, transportFailure);
    } catch {
      // Diagnostics must never change the request outcome.
    }
    if (failure) {
      failure.requestId = requestId;
      failure.clientRequestId = clientRequestId;
      failure.durationMs = durationMs;
      if (transportFailure) failure.diagnostics = { ...trace, stage };
    }
    const details = {
      endpointPath,
      method: diagnosticMethod,
      status,
      requestId,
      clientRequestId,
      durationMs,
      failureKind,
      ...(transportFailure ? { stage } : {}),
    };
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
      i18n.t('common.errors.refreshOutcomeUnknown', { defaultValue: '登录状态暂时无法确认，请重新登录后继续' }),
      { status: 0, failureKind: 'refresh-outcome-unknown' },
    );
  }

  let refreshResponseStatus: number | undefined;
  let refreshResponseDetails: SessionDiagnosticContext = {};
  const refreshRequestId = createHttpRequestId();
  let stage = 'prepare';
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

    // Rotation can commit even if the response is lost or this process is killed.
    // Fence the old credential on disk before sending it, not after an error.
    await useAuthStore.getState().prepareRefresh(refreshRequestId);
    assertSessionEpoch(sessionEpoch);
    const stableDeviceId = await readStableDeviceId();
    assertSessionEpoch(sessionEpoch);
    stage = 'request';
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
      },
      undefined,
      { preparedRequestId: refreshRequestId },
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

    stage = 'persist';
    await currentAuthState.setTokens(tokens);
    assertSessionEpoch(sessionEpoch);

    return tokens.accessToken;
  })()
    .catch(async (error) => {
      assertSessionEpoch(sessionEpoch);
      const responseStatus = refreshResponseStatus ?? (error instanceof ApiError ? error.responseStatus ?? error.status : undefined);
      // 连接都没建成（离线、电梯里、切 Wi-Fi）：保留会话、解除围栏，下次照常续签。
      // 就算服务端其实已经轮换，重放也只撤销本设备这一个会话族，结果和围栏一样是
      // 重新登录；而远更常见的离线回前台，就不必逼用户输密码。超时 / 5xx / 网关
      // 这类请求确实到过服务器的不确定结果，仍走下面的围栏。
      if (stage === 'request' && error instanceof ApiError && error.failureKind === 'network') {
        try {
          await useAuthStore.getState().releaseRefreshAttempt(refreshRequestId);
        } catch {
          reportError(new Error('Authentication refresh fence could not be released'), {
            operation: 'session', kind: 'refreshStatePersist',
          });
        }
        assertSessionEpoch(sessionEpoch);
        throw error;
      }
      if (!isDefinitiveAuthFailure(error)) {
        const invalidResponse = stage === 'request' && responseStatus !== undefined && responseStatus >= 200 && responseStatus < 300;
        const state = useAuthStore.getState();
        const persistence = state.markRefreshUncertain(refreshRequestId);
        const context: SessionDiagnosticContext = {
          endpointPath: '/auth/refresh', method: 'POST', status: responseStatus, stage,
          requestId: error instanceof ApiError ? error.requestId : undefined,
          clientRequestId: refreshRequestId,
          durationMs: error instanceof ApiError ? error.durationMs : undefined,
          failureKind: error instanceof ApiError ? error.failureKind : 'unexpected',
          responseShape: 'unknown', ...refreshResponseDetails,
          authenticated: state.isAuthenticated, hasAccessToken: Boolean(state.accessToken),
          hasRefreshToken: Boolean(state.refreshToken), sessionPreserved: true,
        };
        const diagnosticId = recordSessionDiagnostic(invalidResponse ? 'refresh-response-invalid' : 'refresh-outcome-unknown', context);
        reportError(new Error('Authentication refresh outcome unavailable'), {
          ...context, diagnosticId, operation: 'session', kind: invalidResponse ? 'refreshResponseInvalid' : 'refreshOutcomeUnknown',
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
          i18n.t(invalidResponse ? 'common.errors.refreshResponseInvalid' : 'common.errors.refreshOutcomeUnknown', { defaultValue: '登录状态暂时无法确认，请重新登录后继续' }),
          { status: responseStatus ?? 0, failureKind: invalidResponse ? 'refresh-response-invalid' : 'refresh-outcome-unknown',
            reportEndpoint: '/auth/refresh', reportMethod: 'POST', requestId: context.requestId, clientRequestId: refreshRequestId, durationMs: context.durationMs },
        );
      }
      // Only an explicit server rejection clears the session. Ambiguous failures
      // retain the session and fence the credential rather than replaying it.
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
  if (error instanceof ApiError && ['refresh-response-invalid', 'refresh-outcome-unknown', 'auth-retry-response-replayed'].includes(error.failureKind ?? '')) return false;
  if (error instanceof ApiError && error.failureKind === 'invalid-json') {
    return true;
  }

  return shouldReportHttpFailure(status);
}

type StallRetryReport = { attempts: number; retry: 'recovered' | 'failed' };

// Report unexpected backend failures (network + 5xx) to Sentry; expected
// 4xx (validation/auth/not-found) are left to normal handling.
function reportApiFailure(
  error: unknown,
  endpoint: string,
  options: RequestOptions,
  stallRetry?: StallRetryReport,
): void {
  const status = error instanceof ApiError ? error.status : undefined;
  if (!shouldReportApiFailure(error, status)) return;
  const reportEndpoint =
    error instanceof ApiError ? error.reportEndpoint ?? endpoint : endpoint;
  const reportMethod =
    error instanceof ApiError
      ? error.reportMethod ?? options.method ?? 'GET'
      : options.method ?? 'GET';
  const captureContext = {
    // 诊断字段放最前：下面的固定字段同名时以它们为准。
    ...(error instanceof ApiError ? error.diagnostics : undefined),
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
    ...stallRetry,
  };
  const signature = [
    captureContext.endpointPath,
    captureContext.method,
    status,
    captureContext.apiCode,
    captureContext.failureKind,
    stallRetry?.retry,
  ].join(':');
  try {
    if (shouldCaptureFailure(signature)) reportError(error, captureContext);
  } catch {
    // A reporting SDK must not replace the original business error.
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { auth = true, retryOnAuthError = true } = options;
  const diagnosticSessionEpoch = useAuthStore.getState().sessionEpoch;
  const requestSessionEpoch =
    auth && retryOnAuthError ? useAuthStore.getState().sessionEpoch : null;
  // 只有 GET 在卡住 / 连接判死时自动换新请求重试：幂等，重发不会造成重复写入。
  const retriesStall = (options.method ?? 'GET').toUpperCase() === 'GET';
  const sessionUnchanged = () => useAuthStore.getState().sessionEpoch === diagnosticSessionEpoch;
  // 卡顿已按「第一次的现场」报过时，不再把重试的失败重复报一次。
  let stallReported = false;
  try {
    let initialRequest: Awaited<ReturnType<typeof executeRequest<T>>>;
    try {
      initialRequest = await executeRequest<T>(
        endpoint,
        options,
        undefined,
        retriesStall ? { stallCheckMs: GET_STALL_CHECK_MS } : {},
      );
    } catch (stall) {
      if (
        !retriesStall ||
        !(stall instanceof ApiError) ||
        !GET_RETRYABLE_FAILURES.has(stall.failureKind ?? '') ||
        !sessionUnchanged()
      ) {
        throw stall;
      }
      // 卡顿是在检查点被叫停的；连接判死则在任意时刻，按实际耗时扣。
      const spentMs = stall.failureKind === 'stalled' ? GET_STALL_CHECK_MS : stall.durationMs ?? 0;
      try {
        initialRequest = await executeRequest<T>(endpoint, options, undefined, {
          timeoutMs: Math.max(REQUEST_TIMEOUT_MS - spentMs, GET_RETRY_MIN_TIMEOUT_MS),
        });
      } catch (retryError) {
        // 重试也没拿到响应：用户看到的是重试的报错，上报的是第一次卡住的现场。
        if (retryError instanceof ApiError && retryError.status === 0 && sessionUnchanged()) {
          reportApiFailure(stall, endpoint, options, { attempts: 2, retry: 'failed' });
          stallReported = true;
        }
        throw retryError;
      }
      // 重试拿到了响应（无论状态码）：卡顿救回来了，用户无感，但也要留下现场。
      // 之后若是 5xx / 刷新失败，那是另一件事，由外层照常上报。
      if (sessionUnchanged()) {
        reportApiFailure(stall, endpoint, options, { attempts: 1, retry: 'recovered' });
      }
    }

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
    // The error is still re-thrown exactly as before; reporting is a side channel.
    if (!stallReported && sessionUnchanged()) reportApiFailure(error, endpoint, options);
    throw error;
  }
}
