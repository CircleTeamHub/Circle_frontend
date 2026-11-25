import { Platform } from 'react-native';
export { readJwtSession as readWebSessionIdentity } from '@/utils/jwt-expiry';

/**
 * 网页版的登录态。
 *
 * 浏览器没有系统钥匙串：刷新凭证要是放进 localStorage，页面里任何一段注入脚本都能读走。
 * 所以刷新凭证和设备标识由后端写进 HttpOnly Cookie（脚本读不到，刷新页面也还在），
 * 内存里只留短期的 access token；页面重新加载后靠 Cookie 续签一次就恢复登录。
 *
 * 每个请求都带 X-Web-Session 头、以 credentials: 'include' 发出。后端只在见到这个头时才读写
 * Cookie；别的网站想带这个头跨域请求，要先过预检，过不了跨域白名单。
 */
export const WEB_SESSION_HEADER = 'X-Web-Session';

/** store 里 refreshToken 的占位值：真凭证在 Cookie 里，这里只表示「有会话」。 */
export const WEB_COOKIE_REFRESH_TOKEN = 'web-cookie-session';
export const WEB_SESSION_CHANGED = 'AUTH_WEB_SESSION_CHANGED';

export function webSessionBindingHeader(binding: string) {
  // 旧后端已放行 Authorization，并且认证端点不从这里读取 Cookie 凭证。
  return { Authorization: `WebSession ${binding}` };
}

export function usesWebSessionCookie(): boolean {
  return Platform.OS === 'web';
}

export function isWebSessionChanged(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'errorCode' in error && error.errorCode === WEB_SESSION_CHANGED;
}

let pendingWebLogout: { sessionEpoch: number; request: Promise<void> } | null = null;

export function trackWebLogout(sessionEpoch: number, request: Promise<void>): Promise<void> {
  const logout = { sessionEpoch, request };
  pendingWebLogout = logout;
  return request.finally(() => {
    if (pendingWebLogout === logout) pendingWebLogout = null;
  });
}

export function getPendingWebLogout(sessionEpoch: number): Promise<void> | null {
  return pendingWebLogout?.sessionEpoch === sessionEpoch ? pendingWebLogout.request : null;
}

export function writesWebSessionCookie(method: string, endpoint: string): boolean {
  return usesWebSessionCookie() && method === 'POST' && (
    endpoint === '/auth/login' || endpoint === '/auth/register' ||
    endpoint === '/auth/refresh' || endpoint === '/auth/logout' ||
    /^\/auth\/login-challenges\/[^/]+\/(verify|security-code|security-questions)$/.test(endpoint)
  );
}

/**
 * 同一浏览器的标签页共用 Cookie。串行处理会写 Cookie 的请求，避免一份迟到的续签
 * 或登出回包覆盖另一个标签页刚完成的登录。Cookie 在 fetch 收到响应头时已处理。
 */
export async function withWebSessionLock<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return run();
  let result!: T;
  await locks.request('circle-im-auth-refresh', { signal }, async () => {
    result = await run();
  });
  return result;
}

/** 网页版的登录/续签回包只有 accessToken：补上占位的 refreshToken，再走与原生相同的校验和落库。 */
export function withWebRefreshToken(value: unknown): unknown {
  if (!usesWebSessionCookie() || !value || typeof value !== 'object') return value;
  return { ...(value as Record<string, unknown>), refreshToken: WEB_COOKIE_REFRESH_TOKEN };
}
