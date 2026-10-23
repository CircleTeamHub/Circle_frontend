/**
 * redact.ts — 日志脱敏
 *
 * 从 services/api/client.ts 抽出：api 客户端与 client-diagnostics 都要脱敏，
 * 但 utils → services 是反向依赖（且有环的风险）。放在 utils 下让两侧共享同一份
 * 字段清单——清单只此一处，新增敏感字段不会漏改其中一边。
 *
 * observability/sentry.ts 的上报脱敏也用这一份（isSensitiveFieldKey）。它曾经自己
 * 抄了一份，两边分叉过两次：这边有 revocationsecret / qrtoken / pollkey，Sentry
 * 那份漏了；那份有 email / phone，这边漏了。本模块不 import 任何东西，好让两侧共用。
 */

// dev 日志与 Sentry 上报中匹配到（不区分大小写）任意层级的这些 key 会被替换为
// [REDACTED]。防止 password/token/Authorization/cookie、联系方式等通过控制台、
// Metro 日志、屏幕录制或第三方上报泄漏。
const SENSITIVE_KEYS = new Set([
  'password',
  // review 修复：忘记密码流新增的两个敏感字段 —— 一次性重置码与新密码，
  // dev 日志里出现等于把接管账号的凭据吐给 Metro/设备日志。
  'newpassword',
  'code',
  'token',
  'accesstoken',
  'refreshtoken',
  'revocationsecret',
  // 二维码令牌和轮询凭证可能授权加入好友、群组或圈子。即使只放在请求体，
  // dev 下 apiClient 也会记录请求体，因此必须统一脱敏。
  'qrtoken',
  'pollkey',
  'imtoken',
  'idtoken',
  'authorization',
  'cookie',
  'apikey',
  'secret',
  // 联系方式：可直接定位到人。
  'email',
  'phone',
  'phonenumber',
  'mobile',
]);
const SENSITIVE_URL_KEYS = new Set(['uploadurl', 'fileurl']);

/** 字段名是否敏感（不区分大小写）。日志脱敏与 Sentry 上报共用。 */
export function isSensitiveFieldKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_URL_KEYS.has(normalized);
}
const PRESIGNED_URL_MARKERS = [
  'X-Amz-Algorithm=',
  'X-Amz-Credential=',
  'X-Amz-Signature=',
  'x-id=PutObject',
];
const SENSITIVE_URL_PATTERN = /https?:\/\/[^\s"'<>)]*\?[^\s"'<>)]*/gi;
// QR tokens are bearer credentials carried in the path, so query-string
// redaction alone would still expose them in dev request logs.
const QR_TOKEN_PATH_PATTERN = /(\/qr\/tokens\/)[A-Za-z0-9_-]{16,128}(?=\/|$)/gi;

function redactSensitiveString(value: string): string {
  if (PRESIGNED_URL_MARKERS.some((marker) => value.includes(marker))) {
    return '[REDACTED_URL]';
  }
  return value.replace(SENSITIVE_URL_PATTERN, '[REDACTED_URL]');
}

export function redactSensitiveUrl(value: string): string {
  return redactSensitiveString(value).replace(
    QR_TOKEN_PATH_PATTERN,
    '$1[REDACTED]',
  );
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
    redacted[k] =
      isSensitiveFieldKey(k) || shouldRedactObjectKey(k, v)
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
