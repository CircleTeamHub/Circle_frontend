/**
 * knownAccountsStore.ts — 本设备登录过的账号列表（持久化到 MMKV）
 *
 * 用于「切换账号」：保存每个登录过的账号的 token + 资料，支持免密快速切号。
 * - 登录成功 / 切号成功时 upsert（最近使用排最前）
 * - 「退出登录」时移除当前账号
 * - 切号时若发现 session 已过期，移除该死账号
 *
 * 安全说明：与单活跃会话一致，token 存于 MMKV。等价于微信/Telegram 的多账号快速切换。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import {
  upsertKnownAccount,
  removeKnownAccount,
  type KnownAccount,
} from '@/stores/knownAccountsLogic';

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

      removeAccount: (userId) =>
        set((state) => ({
          accounts: removeKnownAccount(state.accounts, userId),
        })),

      clearAccounts: () => set({ accounts: [] }),
    }),
    {
      name: 'circle-im-known-accounts',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({ accounts: state.accounts }),
    },
  ),
);
