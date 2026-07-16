import { redactSensitiveFields } from '@/utils/redact';

type DiagnosticDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * 仅 dev 的诊断日志。两层防护，缺一不可：
 * - __DEV__ 短路：production 里连字符串拼接都不做。babel 的 transform-remove-console
 *   已经会剥掉 console.warn，但那是构建配置——配置一旦漏掉（api.env('production')
 *   没解析到等），这里就成了明文出口。不能把「不泄漏」只押在构建配置上。
 * - redactSensitiveFields：details 是调用方自由传的字段，原来只滤了 undefined。
 *   token / password 这类 key 走共享脱敏表，与 api 客户端同一份清单。
 */
export function logClientDiagnostic(
  event: string,
  details: DiagnosticDetails = {},
) {
  if (!isDev) {
    return;
  }

  const sanitized = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );

  console.warn(`[client-diagnostic] ${event}`, redactSensitiveFields(sanitized));
}
