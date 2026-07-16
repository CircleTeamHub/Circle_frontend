/**
 * redact.ts — 日志脱敏
 *
 * 从 services/api/client.ts 抽出：api 客户端与 client-diagnostics 都要脱敏，
 * 但 utils → services 是反向依赖（且有环的风险）。放在 utils 下让两侧共享同一份
 * 字段清单——清单只此一处，新增敏感字段不会漏改其中一边。
 */

// dev 日志中匹配到（不区分大小写）任意层级的这些 key 会被替换为 [REDACTED]。
// 防止 password/token/Authorization/cookie 等通过控制台、Metro 日志、屏幕录制泄漏。
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'revocationsecret',
  'imtoken',
  'idtoken',
  'authorization',
  'cookie',
  'apikey',
  'secret',
]);
const SENSITIVE_URL_KEYS = new Set(['uploadurl', 'fileurl']);
const PRESIGNED_URL_MARKERS = [
  'X-Amz-Algorithm=',
  'X-Amz-Credential=',
  'X-Amz-Signature=',
  'x-id=PutObject',
];

function redactSensitiveString(value: string): string {
  return PRESIGNED_URL_MARKERS.some((marker) => value.includes(marker))
    ? '[REDACTED_URL]'
    : value;
}

function shouldRedactObjectKey(key: string, value: unknown): boolean {
  return (
    key.toLowerCase() === 'key' &&
    typeof value === 'string' &&
    value.includes('/')
  );
}

export function redactSensitiveFields(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (typeof value === 'string') return redactSensitiveString(value);
  if (typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    redacted[k] =
      SENSITIVE_KEYS.has(key) ||
      SENSITIVE_URL_KEYS.has(key) ||
      shouldRedactObjectKey(k, v)
      ? '[REDACTED]'
      : redactSensitiveFields(v);
  }
  return redacted;
}

export function redactSensitiveHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}
