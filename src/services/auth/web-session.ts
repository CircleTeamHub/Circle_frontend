import { Platform } from 'react-native';

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

export function usesWebSessionCookie(): boolean {
  return Platform.OS === 'web';
}

/**
 * 同一浏览器的多个标签页共用一个 Cookie。两个标签页同时拿同一个旧凭证续签，后到的会被
 * 服务端当成重放而吊销整组会话，所以续签请求跨标签页排队（Web Locks，Safari 15.4+）。
 */
export async function withWebRefreshLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return run();
  let result!: T;
  await locks.request('circle-im-auth-refresh', async () => {
    result = await run();
  });
  return result;
}

/** 网页版的登录/续签回包只有 accessToken：补上占位的 refreshToken，再走与原生相同的校验和落库。 */
export function withWebRefreshToken(value: unknown): unknown {
  if (!usesWebSessionCookie() || !value || typeof value !== 'object') return value;
  return { ...(value as Record<string, unknown>), refreshToken: WEB_COOKIE_REFRESH_TOKEN };
}
