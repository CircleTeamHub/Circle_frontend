/**
 * knownAccountsLogic.ts — 多账号列表的纯函数逻辑（无原生依赖，便于单测）
 *
 * 仅 `import type`，运行时不拉入 authStore / storage。
 */
import type { AuthUser } from '@/stores/authStore';
// @ts-ignore The Node test runner and Metro both resolve explicit TypeScript modules.
import { migratePersistedUser } from './appearance-migration.ts';

export interface KnownAccount {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  updatedAt: number;
}

export const KNOWN_ACCOUNTS_PERSIST_VERSION = 1;

function isPersistedKnownAccount(value: unknown): value is {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  updatedAt: number;
} {
  if (typeof value !== 'object' || value === null) return false;
  const account = value as Record<string, unknown>;
  if (
    typeof account.accessToken !== 'string' ||
    account.accessToken.length === 0 ||
    typeof account.refreshToken !== 'string' ||
    account.refreshToken.length === 0 ||
    typeof account.updatedAt !== 'number' ||
    !Number.isFinite(account.updatedAt) ||
    typeof account.user !== 'object' ||
    account.user === null
  ) {
    return false;
  }
  const user = account.user as Record<string, unknown>;
  return typeof user.id === 'string' && user.id.length > 0;
}

export function migrateKnownAccountsPersist(
  persistedState: unknown,
): Record<string, unknown> {
  if (typeof persistedState !== 'object' || persistedState === null) {
    return {};
  }
  const state = persistedState as Record<string, unknown>;
  if (!Array.isArray(state.accounts)) return state;
  return {
    ...state,
    // Drop malformed records at the persistence boundary. Keeping them would
    // make every consumer trust a cast and can crash the account switcher.
    accounts: state.accounts
      .filter(isPersistedKnownAccount)
      .map((account) => ({
        ...account,
        user: migratePersistedUser(account.user),
      })),
  };
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
