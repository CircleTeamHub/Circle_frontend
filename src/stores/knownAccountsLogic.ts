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

export const KNOWN_ACCOUNTS_PERSIST_VERSION = 1;

function migrateKnownAccountUser(user: AuthUser): AuthUser {
  const rawUser = user as unknown as Record<string, unknown>;
  const hasAppearance = Object.prototype.hasOwnProperty.call(
    rawUser,
    'avatarFrameAppearance',
  );
  const rawAppearance = rawUser.avatarFrameAppearance;
  const appearanceRecord =
    rawAppearance &&
    typeof rawAppearance === 'object' &&
    !Array.isArray(rawAppearance)
      ? (rawAppearance as Record<string, unknown>)
      : null;
  const parsedAppearance =
    appearanceRecord &&
    typeof appearanceRecord.id === 'string' &&
    typeof appearanceRecord.key === 'string' &&
    typeof appearanceRecord.name === 'string' &&
    (appearanceRecord.imageUrl === null ||
      typeof appearanceRecord.imageUrl === 'string')
      ? {
          id: appearanceRecord.id,
          key: appearanceRecord.key,
          name: appearanceRecord.name,
          imageUrl: null,
        }
      : null;
  const vipLevel =
    typeof rawUser.vipLevel === 'number' ? rawUser.vipLevel : null;
  const avatarFrameAppearance = hasAppearance
    ? parsedAppearance
    : vipLevel === 3
      ? {
          id: 'legacy-membership-diamond',
          key: 'membership-diamond',
          name: 'Diamond membership frame',
          imageUrl: null,
        }
      : vipLevel !== null && vipLevel >= 4
        ? {
            id: 'legacy-membership-super',
            key: 'membership-super',
            name: 'Super membership frame',
            imageUrl: null,
          }
        : null;
  return {
    ...user,
    avatarFrame: null,
    avatarFrameAppearance,
  };
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
    accounts: state.accounts.map((account) => {
      if (
        typeof account !== 'object' ||
        account === null ||
        !('user' in account) ||
        typeof account.user !== 'object' ||
        account.user === null
      ) {
        return account;
      }
      return {
        ...account,
        user: migrateKnownAccountUser(account.user as AuthUser),
      };
    }),
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
