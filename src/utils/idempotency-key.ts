/**
 * idempotency-key.ts — 幂等键生成
 *
 * 金额类 POST（/coin/gift、/coin/recharge 等）随请求带 `Idempotency-Key` header
 * 发给后端；同一逻辑动作的内部 401→refresh 重试会复用同一 options（含 header），
 * 因此同一个键会被复用，后端据此去重，防止刷新竞态 / 弱网重放导致的重复扣费。
 *
 * 幂等键只是去重标识、不需要加密强度：优先 expo-crypto 的 randomUUID，
 * 在 web / 测试等无该模块的环境退化到时间戳 + 随机串。
 */
export function generateIdempotencyKey(): string {
  try {
    if (typeof require === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const crypto = require('expo-crypto') as { randomUUID?: () => string };
      const uuid = crypto.randomUUID?.();
      if (typeof uuid === 'string' && uuid.length >= 16) {
        return uuid;
      }
    }
  } catch {
    // expo-crypto 不可用（web / node 测试）时退化到下方 fallback。
  }
  return `idmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
