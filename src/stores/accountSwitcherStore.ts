/**
 * accountSwitcherStore.ts — 账号切换 sheet 的全局开关（运行时状态，不持久化）
 *
 * sheet 在 app 根布局挂载一份，任意页面通过 open() 唤起，避免在多个设置页重复接线。
 */
import { create } from 'zustand';

interface AccountSwitcherState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useAccountSwitcherStore = create<AccountSwitcherState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
