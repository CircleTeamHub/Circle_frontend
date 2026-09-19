/**
 * 读 access token 的到期时刻(只解码、不验签)。
 *
 * 用途只有一个:实时通道被服务端断开、或准备建连时,判断是不是 token 过期了 ——
 * 过期就先走一次刷新,而不是拿着过期 token 反复重连。授权判断永远以服务端为准。
 */

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 自己解 base64url:RN 各运行时的 atob / TextDecoder 支持不一致。
 * 字节按 Latin-1 拼成字符串 —— 这里只读 exp(ASCII 键 + 数字),其余声明里的
 * 多字节 UTF-8 会变成 \u0080 以上的字符,仍是合法 JSON 字符串内容。
 */
function decodeBase64Url(segment: string): string | null {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  let decoded = '';
  for (const byte of bytes) decoded += String.fromCharCode(byte);
  return decoded;
}

export function readJwtExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const json = decodeBase64Url(parts[1]);
  if (json === null) return null;
  try {
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== 'object') return null;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** skewMs 内即将到期也算过期:拿着还剩几秒的 token 建连,握手完就被断开。 */
export function isJwtExpired(
  token: string,
  nowMs: number = Date.now(),
  skewMs = 30_000,
): boolean {
  const expiresAt = readJwtExpiryMs(token);
  return expiresAt !== null && expiresAt - skewMs <= nowMs;
}
