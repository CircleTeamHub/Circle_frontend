/**
 * knownAccountsStore.ts — 本设备登录过的账号列表（凭证持久化到系统 SecureStore）
 *
 * 用于「切换账号」：保存每个登录过的账号的 token + 资料，支持免密快速切号。
 * - 登录成功 / 切号成功时 upsert（最近使用排最前）
 * - 「退出登录」时移除当前账号
 * - 切号时若发现 session 已过期，移除该死账号
 *
 * 安全说明：与单活跃会话一致，token 通过 SecureStore 保存；账号展示 metadata 留在 MMKV，
 * 旧 MMKV token 会在读取时迁移到 SecureStore 并从 MMKV metadata 中剥离。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  markKnownAccountRemoved,
  secureAuthStorage,
} from '@/storage/secure-auth-storage';
import {
  upsertKnownAccount,
  removeKnownAccount,
  type KnownAccount,
} from '@/stores/knownAccountsLogic';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export type { KnownAccount };

interface KnownAccountsState {
  accounts: KnownAccount[];
  upsertAccount: (account: KnownAccount) => void;
  removeAccount: (userId: string) => void;
  clearAccounts: () => void;
}

export const useKnownAccountsStore = create<KnownAccountsState>()(
  persist(
    (set) => ({
      accounts: [],

      upsertAccount: (account) =>
        set((state) => ({
          accounts: upsertKnownAccount(state.accounts, account),
        })),

      removeAccount: (userId) => {
        markKnownAccountRemoved(userId);
        set((state) => ({
          accounts: removeKnownAccount(state.accounts, userId),
        }));
      },

      clearAccounts: () => set({ accounts: [] }),
    }),
    {
      name: 'circle-im-known-accounts',
      storage: createJSONStorage(() => secureAuthStorage),
      partialize: (state) => ({ accounts: state.accounts }),
      // 读失败时 secureAuthStorage 已进入 degraded（merge-only、不删 token），
      // 这里仅做可观测性记录，避免静默吞掉 Keychain 读错误。
      onRehydrateStorage: () => (_state, error) => {
        if (error && isDev) {
          console.warn(
            '[knownAccountsStore] hydration read failed; switcher tokens preserved (degraded)',
            error,
          );
        }
      },
    },
  ),
);
