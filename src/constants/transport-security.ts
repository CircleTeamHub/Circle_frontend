/**
 * transport-security.ts — 传输层安全校验（纯函数，无 RN / expo 依赖，便于单测）
 *
 * 目的：release 构建里禁止明文 http/ws 打到公网 host，避免误配把 Bearer token /
 * 金额报文走明文（见 config.ts 的调用点）。
 *
 * 放行规则（任一成立即放行）：
 *   1. dev 构建（__DEV__）—— 本地开发一律放行，不受影响；
 *   2. 目标是私网 / 本机 host —— 局域网自托管、模拟器回环联调；
 *   3. 显式 opt-in（EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT）—— 测试期明文公网 IP。
 *
 * 本模块只做「判定」，不读 __DEV__ / env（由 config.ts 传入），因此可脱离 RN 环境单测。
 */

export type TransportClass =
  | 'secure' // https / wss
  | 'insecure-local' // http / ws 打到私网或本机
  | 'insecure-remote' // http / ws 打到公网 —— release 下需拦截
  | 'unparseable'; // 解析失败或非 http(s)/ws(s)，不拦截，交给使用处自然报错

/** localhost / 环回 / IPv4 私网段 / link-local：本机与局域网自托管测试放行。 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  ) {
    return true;
  }
  return (
    /^10\./.test(host) || // 10.0.0.0/8
    /^192\.168\./.test(host) || // 192.168.0.0/16
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || // 172.16.0.0/12
    /^169\.254\./.test(host) // 169.254.0.0/16 link-local
  );
}

/** 仅依据 URL 本身分类，不看 __DEV__ / opt-in。 */
export function classifyTransport(rawUrl: string): TransportClass {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'unparseable';
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'wss:') {
    return 'secure';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') {
    return 'unparseable';
  }
  return isPrivateOrLocalHost(parsed.hostname)
    ? 'insecure-local'
    : 'insecure-remote';
}

function redactUrlForError(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const portPart = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${portPart}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

export interface TransportGuardOptions {
  /** dev 构建：一律放行（本地开发不受影响）。 */
  isDev: boolean;
  /** 显式放行明文（测试期明文公网 IP）：EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT。 */
  allowInsecure: boolean;
}

/**
 * 在 release 且未放行时，对「明文公网地址」返回错误信息字符串（调用方据此 throw）；
 * 其余情况返回 null（放行）。纯函数：把「是否拦」与「如何拦」分离，便于单测。
 */
export function evaluateTransportGuard(
  rawUrl: string,
  label: string,
  options: TransportGuardOptions,
): string | null {
  if (options.isDev || options.allowInsecure) {
    return null;
  }
  if (classifyTransport(rawUrl) === 'insecure-remote') {
    return (
      `[config] 不安全的 ${label}: 明文地址「${redactUrlForError(rawUrl)}」在 release 构建中被拒绝。` +
      '请改用 https/wss；若确为测试期明文 IP，请在构建环境设置 ' +
      'EXPO_PUBLIC_ALLOW_INSECURE_TRANSPORT=1 显式放行。'
    );
  }
  return null;
}
