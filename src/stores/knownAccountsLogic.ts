/**
 * knownAccountsLogic.ts — 多账号列表的纯函数逻辑（无原生依赖，便于单测）
 *
 * 仅 `import type`，运行时不拉入 authStore / storage。
 */
import type { AuthUser } from '@/stores/authStore';

export interface KnownAccount {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  imToken: string | null;
  updatedAt: number;
}

/** 同一 userId 去重后插到最前 —— 结果即「最近使用」顺序。 */
export function upsertKnownAccount(
  accounts: readonly KnownAccount[],
  account: KnownAccount,
): KnownAccount[] {
  const others = accounts.filter((item) => item.user.id !== account.user.id);
  return [account, ...others];
}

/** 按 userId 移除一个账号，返回新数组（不修改入参）。 */
export function removeKnownAccount(
  accounts: readonly KnownAccount[],
  userId: string,
): KnownAccount[] {
  return accounts.filter((item) => item.user.id !== userId);
}
