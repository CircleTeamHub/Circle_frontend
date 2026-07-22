import { generateIdempotencyKey } from '@/utils/idempotency-key';

/**
 * 会员升级幂等键（PR #127 review 修复，镜像 transfer-idempotency 模式）。
 *
 * 键必须与「升级意图」同生命周期，而不是每次请求现造：响应丢失/超时后用户
 * 重试同一次升级时，新键会让后端幂等去重完全失效 —— 可能二次扣分。同一
 * 意图（同一目标等级）复用同一枚键；换等级即换键。
 */
export type MembershipUpgradeIdempotency = {
  signature: string;
  key: string;
};

export function resolveMembershipUpgradeIdempotency(
  current: MembershipUpgradeIdempotency | null,
  intent: { level: number },
): MembershipUpgradeIdempotency {
  const signature = JSON.stringify([intent.level]);
  if (current?.signature === signature) return current;
  return { signature, key: generateIdempotencyKey() };
}
