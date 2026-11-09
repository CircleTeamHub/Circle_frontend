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
import { recordMetric } from '@/observability/metrics';
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

// 安卓 RN 的 OkHttp 把同一域名的请求全塞进一条 HTTP/2 连接，它被丢包冻住时，在上面再发多少
// 次都一样卡。备份请求改走独立连接池（modules/fresh-connection），一定是新连接。启动时注册
// （见 app/_layout）；没注册（iOS / web / 还没这个原生模块的旧包）就照常用 fetch。
export type FreshConnectionTransport = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<Response>;
let freshConnectionTransport: FreshConnectionTransport | null = null;

export function registerFreshConnectionTransport(transport: FreshConnectionTransport | null) {
  freshConnectionTransport = transport;
}

// 整个请求的预算（headers + body）。
const REQUEST_TIMEOUT_MS = 15_000;
// GET 到这个时刻还「没动静」（没收到响应头，或 XHR 已完成却没交到 JS）就并行发一份备份请求，
// 谁先回来用谁，另一份随即取消。原请求不叫停：线路丢包时它的回包可能已经在路上了。
// 2026-11 实测（国内测试机连新加坡）：正常的 GET 1 秒内回来；卡住的那次是整条 HTTP/2 连接被
// 丢包冻住，等心跳判死再重连要 10 秒以上，而新连接上的请求通常立刻成功。响应头已到、还在下载
// 的慢请求不算卡住（判断靠 request-trace 钩子；没装钩子的 web 不做这一步）。备份只用剩下的
// 预算，总耗时仍是 REQUEST_TIMEOUT_MS——服务器整个不回包时（冷启动 /auth/me 外面还有一层
// retry）不至于把等待翻倍。
const GET_HEDGE_AFTER_MS = 2_500;
// 连接被判死（安卓 OkHttp 心跳没回音，见 plugins/with-android-okhttp-health）时，挂在上面的
// 请求直接以 network 失败；还没到备份时刻的 GET 立刻换新连接再试一次，同样只用剩下的预算。
const GET_RETRYABLE_FAILURES: ReadonlySet<string> = new Set(['network']);
// 剩余预算再少也给这么多：刚建一条新连接（TLS 握手 + 一个往返）就要这个量级。
const GET_RETRY_MIN_TIMEOUT_MS = 3_000;

type RequestStage = 'device-id' | 'awaiting-response' | 'reading-body';
type RequestBudget = {
  timeoutMs?: number;
  /** 到点还没动静就调 onStalled（不叫停请求，由调用方决定要不要发备份）。 */
  stallCheckMs?: number;
  onStalled?: () => void;
  /** 调用方主动放弃（备份赢了）：按超时收尾，卡过的记成 stalled。 */
  cancelSignal?: AbortSignal;
  /** fresh-connection：GET 走已注册的独立连接通道（安卓），没注册就照常 fetch。 */
  transport?: 'fetch' | 'fresh-connection';
  /** 续签在发送前已把这个 X-Request-Id 写盘做围栏，必须原样发出。 */
  preparedRequestId?: string;
};

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
  {
    timeoutMs = REQUEST_TIMEOUT_MS,
    stallCheckMs,
    onStalled,
    cancelSignal,
    transport = 'fetch',
    preparedRequestId,
  }: RequestBudget = {},
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
  const cancel = () => controller.abort();
  if (cancelSignal?.aborted) cancel();
  else cancelSignal?.addEventListener('abort', cancel, { once: true });
  // 到点还没动静（没收到响应头，或 XHR 已完成却没交到 JS）就告诉调用方，请求本身接着等。
  const stallTimer = stallCheckMs === undefined ? undefined : setTimeout(() => {
    try {
      if (!requestTraceHooks || requestTraceHooks.isReceiving(traceRequestId)) return;
    } catch {
      return;
    }
    stalled = true;
    onStalled?.();
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
      const requestHeaders: Record<string, string> = {
        // 只有 JSON / urlencoded 才由我们设置 Content-Type；
        // FormData 必须让 fetch 自动加上含 multipart boundary 的头。
        ...(serializedBody?.contentType
          ? { 'Content-Type': serializedBody.contentType }
          : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
        ...Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'x-request-id')),
        'X-Request-Id': requestId,
      };
      const viaFreshConnection =
        transport === 'fresh-connection' && freshConnectionTransport !== null && diagnosticMethod === 'GET' && !serializedBody;
      res = await untilAborted(
        viaFreshConnection
          ? freshConnectionTransport!(url, { headers: requestHeaders, timeoutMs })
          : fetch(url, {
              method,
              headers: requestHeaders,
              ...(serializedBody ? { body: serializedBody.body } : {}),
              signal: controller.signal,
            }),
        controller.signal,
      );
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
    return { res, payload, requestId, clientRequestId, responseRequestId, accessToken, durationMs: Math.max(0, Math.round(diagnosticNow() - startedAt)) };
  } catch (error) {
    if (error instanceof ApiError) {
      // 卡过的请求被放弃（备份赢了）或耗尽预算：标成 stalled，上报时与普通超时分开。
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
    cancelSignal?.removeEventListener('abort', cancel);
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
    recordMetric('api.request.duration', durationMs, {
      method: diagnosticMethod, route: endpointPath, outcome: failureKind ?? 'success',
    });
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

  let refreshResponseStatus: number | undefined;
  let refreshResponseDetails: SessionDiagnosticContext = {};
  // 上一次续签没确认结果（超时、断流、进程被杀）就沿用它的尝试 ID：服务端据此认出这是重试，
  // 作废没送到的新令牌再发一个，而不是当成令牌被盗吊销整组会话。
  const refreshRequestId = useAuthStore.getState().refreshAttemptId ?? createHttpRequestId();
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
        headers: {
          'Idempotency-Key': refreshRequestId,
          ...(stableDeviceId ? { 'X-Stable-Device-Id': stableDeviceId } : {}),
        },
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
          defaultValue: '暂时无法更新登录状态，请稍后重试',
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
      // 超时、断流、5xx、限流都说明不了服务端有没有轮换：会话和盘上的尝试 ID 都留着，
      // 下次续签带同一 ID 重试，不用把用户赶回登录页。
      if (!isDefinitiveAuthFailure(error)) {
        const invalidResponse = stage === 'request' && responseStatus !== undefined && responseStatus >= 200 && responseStatus < 300;
        const state = useAuthStore.getState();
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
        if (!invalidResponse) throw error;
        reportError(new Error('Authentication refresh outcome unavailable'), {
          ...context, diagnosticId, operation: 'session', kind: 'refreshResponseInvalid',
        });
        throw new ApiError(
          i18n.t('common.errors.refreshResponseInvalid', { defaultValue: '暂时无法更新登录状态，请稍后重试' }),
          { status: responseStatus, failureKind: 'refresh-response-invalid',
            reportEndpoint: '/auth/refresh', reportMethod: 'POST', requestId: context.requestId, clientRequestId: refreshRequestId, durationMs: context.durationMs },
        );
      }
      // Only an explicit server rejection clears the session.
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
 *
 * rejectedAccessToken 是被服务端拒绝的那个 token:握手比 REST 慢,回来时 token 可能已经
 * 被 REST 那边换过了。换过就不再轮换,session-bootstrap 看到新 token 会带着它重连。
 */
export function refreshSessionAccessToken(rejectedAccessToken?: string): Promise<string> {
  const { accessToken, sessionEpoch } = useAuthStore.getState();
  if (rejectedAccessToken && accessToken && accessToken !== rejectedAccessToken) {
    return Promise.resolve(accessToken);
  }
  return refreshAccessToken(sessionEpoch);
}

function shouldReportApiFailure(error: unknown, status: number | undefined): boolean {
  // Auth anomalies are captured once at their decision boundary.
  if (error instanceof ApiError && ['refresh-response-invalid', 'auth-retry-response-replayed'].includes(error.failureKind ?? '')) return false;
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

type ExecutedRequest<T> = Awaited<ReturnType<typeof executeRequest<T>>>;

/** 两个尝试谁先拿到响应用谁；一个失败就等另一个，两个都失败才按 [第一次, 第二次] 给出错误。 */
function firstResponse<R>(attempts: readonly [Promise<R>, Promise<R>]): Promise<{ index: 0 | 1; value: R }> {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    attempts.forEach((attempt, index) => {
      attempt.then(
        (value) => resolve({ index: index as 0 | 1, value }),
        (error: unknown) => {
          errors[index] = error;
          if (errors.filter((e) => e !== undefined).length === 2) reject(errors);
        },
      );
    });
  });
}

/**
 * GET 的传输：卡住就并行备份、断网就换新连接重试一次（幂等，重发不会造成重复写入）。
 * 上报：备份/重试救回来报第一次的现场 `retry:recovered`；也没拿到响应时只报一次
 * （第一次的现场，`attempts:2, retry:failed`，此时 report.done=true）；会话变了不备份不报。
 */
async function sendGet<T>(
  endpoint: string,
  options: RequestOptions,
  sessionUnchanged: () => boolean,
  report: { done: boolean },
): Promise<ExecutedRequest<T>> {
  const primaryCancel = new AbortController();
  let markStalled = () => {};
  const stalled = new Promise<'stalled'>((resolve) => {
    markStalled = () => resolve('stalled');
  });
  const primary = executeRequest<T>(endpoint, options, undefined, {
    stallCheckMs: GET_HEDGE_AFTER_MS,
    onStalled: markStalled,
    cancelSignal: primaryCancel.signal,
  });
  const first = await Promise.race([
    primary.then((request) => ({ request }), (error: unknown) => ({ error })),
    stalled,
  ]);
  const second = (timeoutMs: number, cancelSignal?: AbortSignal) =>
    executeRequest<T>(endpoint, options, undefined, { timeoutMs, cancelSignal, transport: 'fresh-connection' });
  const giveUp = (stuck: unknown, error: unknown): never => {
    // 第二次也没拿到响应：用户看到的是第二次的报错，上报的是第一次卡住的现场。
    if (error instanceof ApiError && error.status === 0 && sessionUnchanged()) {
      reportApiFailure(stuck, endpoint, options, { attempts: 2, retry: 'failed' });
      report.done = true;
    }
    throw error;
  };
  // 拿到了响应（无论状态码）就算救回来了，用户无感，但也要留下现场。之后若是 5xx /
  // 刷新失败，那是另一件事，由外层照常上报。
  const recovered = (stuck: unknown) => {
    if (sessionUnchanged()) reportApiFailure(stuck, endpoint, options, { attempts: 1, retry: 'recovered' });
  };

  if (first !== 'stalled') {
    if ('request' in first) return first.request;
    const failure = first.error;
    if (!(failure instanceof ApiError) || !GET_RETRYABLE_FAILURES.has(failure.failureKind ?? '') || !sessionUnchanged()) {
      throw failure;
    }
    let retried: ExecutedRequest<T>;
    try {
      retried = await second(Math.max(REQUEST_TIMEOUT_MS - (failure.durationMs ?? 0), GET_RETRY_MIN_TIMEOUT_MS));
    } catch (error) {
      return giveUp(failure, error);
    }
    recovered(failure);
    return retried;
  }

  if (!sessionUnchanged()) return primary;
  const hedgeCancel = new AbortController();
  const hedge = second(Math.max(REQUEST_TIMEOUT_MS - GET_HEDGE_AFTER_MS, GET_RETRY_MIN_TIMEOUT_MS), hedgeCancel.signal);
  let winner: { index: 0 | 1; value: ExecutedRequest<T> };
  try {
    winner = await firstResponse([primary, hedge]);
  } catch (errors) {
    const [stuck, error] = errors as [unknown, unknown];
    return giveUp(stuck, error);
  }
  if (winner.index === 0) {
    hedgeCancel.abort();
    hedge.catch(() => {});
    return winner.value;
  }
  primaryCancel.abort();
  const stuck = await primary.then(() => null, (error: unknown) => error);
  if (stuck) recovered(stuck);
  return winner.value;
}

// 同一时刻、同一账号、同一地址的 GET 只真正发一次：「新的朋友」页一打开，同一个未读数 2 秒内
// 被不同组件各拉 4～5 次，线路差时请求越多越容易互相拖住。只合并还在路上的请求，落地即撤，
// 不做缓存。不止一个调用方时每人拿一份深拷贝：调用方可能就地改数据（排序、补字段）。
const inflightGets = new Map<string, { result: Promise<unknown>; joiners: number }>();

function inflightKey(endpoint: string, options: RequestOptions): string | null {
  if ((options.method ?? 'GET').toUpperCase() !== 'GET' || options.body !== undefined || options.onResponseHeaders) {
    return null;
  }
  return JSON.stringify([
    useAuthStore.getState().sessionEpoch,
    options.auth ?? true,
    options.accessToken ?? null,
    options.retryOnAuthError ?? true,
    endpoint,
    options.headers ?? {},
  ]);
}

const copyJson = <T>(data: T): T =>
  data !== null && typeof data === 'object' ? (JSON.parse(JSON.stringify(data)) as T) : data;

export function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const key = inflightKey(endpoint, options);
  if (key === null) return requestOnce<T>(endpoint, options);
  const inflight = inflightGets.get(key);
  if (inflight) {
    inflight.joiners += 1;
    return inflight.result.then((data) => copyJson(data as T));
  }
  const entry = { result: requestOnce<T>(endpoint, options) as Promise<unknown>, joiners: 0 };
  inflightGets.set(key, entry);
  // 先于任何调用方的回调执行：落地后的新调用不会再并进来，joiners 在这之后不再变。
  const release = () => {
    if (inflightGets.get(key) === entry) inflightGets.delete(key);
  };
  entry.result.then(release, release);
  return entry.result.then((data) => (entry.joiners > 0 ? copyJson(data as T) : (data as T)));
}

async function requestOnce<T>(
  endpoint: string,
  options: RequestOptions,
): Promise<T> {
  const { auth = true, retryOnAuthError = true } = options;
  const diagnosticSessionEpoch = useAuthStore.getState().sessionEpoch;
  const requestSessionEpoch =
    auth && retryOnAuthError ? useAuthStore.getState().sessionEpoch : null;
  const isGet = (options.method ?? 'GET').toUpperCase() === 'GET';
  const sessionUnchanged = () => useAuthStore.getState().sessionEpoch === diagnosticSessionEpoch;
  // 卡顿已按「第一次的现场」报过时，不再把第二次的失败重复报一次。
  const transportReport = { done: false };
  try {
    let initialRequest = isGet
      ? await sendGet<T>(endpoint, options, sessionUnchanged, transportReport)
      : await executeRequest<T>(endpoint, options);

    // An authenticated current-password check can fail without invalidating the session.
    const rejectedBySession = (request: ExecutedRequest<T>) =>
      request.res.status === 401 && auth && retryOnAuthError &&
      (request.payload as { errorCode?: string } | null)?.errorCode !== 'AUTH_PASSWORD_INCORRECT';

    // 发出时用的 token 已经被别的请求换掉了:这个 401 说明不了现在的 token,先换上它重发。
    // 直接再续签只会多轮换一次,多一段「续签中进程结束,下次启动要重新登录」的窗口。
    // 重发还被拒才交给下面的正常续签,这里不判登出。
    const latestAccessToken = useAuthStore.getState().accessToken;
    if (requestSessionEpoch !== null && rejectedBySession(initialRequest) &&
      latestAccessToken && latestAccessToken !== initialRequest.accessToken) {
      assertSessionEpoch(requestSessionEpoch);
      initialRequest = await executeRequest<T>(endpoint, options, latestAccessToken);
    }

    if (rejectedBySession(initialRequest)) {
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
    if (!transportReport.done && sessionUnchanged()) reportApiFailure(error, endpoint, options);
    throw error;
  }
}
