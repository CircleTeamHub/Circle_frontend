/**
 * accountSwitcherStore.ts — 账号切换 sheet 的全局开关（运行时状态，不持久化）
 *
 * sheet 在 app 根布局挂载一份，任意页面通过 open() 唤起，避免在多个设置页重复接线。
 */
import { create } from 'zustand';

interface AccountSwitcherState {
  isOpen: boolean;
  /**
   * 切换账号进行中。切换要先 teardown 旧会话(isAuthenticated 短暂为 false)再激活新账号,
   * 根守卫若在这段空窗里按「未登录」重定向到登录页,就会和切换完成后的跳转抢导航
   * (落在登录页卡住、tabs 被挂两次)。进行中守卫原地不动,只由切换流程自己跳转。
   */
  switching: boolean;
  open: () => void;
  close: () => void;
  setSwitching: (switching: boolean) => void;
}

export const useAccountSwitcherStore = create<AccountSwitcherState>((set) => ({
  isOpen: false,
  switching: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSwitching: (switching) => set({ switching }),
}));
