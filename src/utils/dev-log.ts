/**
 * dev-log.ts — 仅开发期的控制台输出。
 *
 * 业务代码里不许直接写 `console.warn`（test/handled-failure-coverage.test.js 钉住）：
 * - 需要「留下信号」的失败走 observability/report-failure 的 reportHandledFailure
 *   （dev 打印 + 面包屑 + 去重后进 Sentry）；
 * - 只想在本地看一眼、生产不需要任何信号的信息性输出（例如已在别处上报过、
 *   这里只补一行上下文）才用这里的 devWarn。
 *
 * 生产构建由 babel 的 transform-remove-console 剥掉 console.warn，但那是构建配置——
 * 配置一旦漏掉这里就成了明文出口，所以 __DEV__ 短路必须自己做，不能只押在构建上。
 */
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function devWarn(...args: unknown[]): void {
  if (!isDev) return;
  console.warn(...args);
}
