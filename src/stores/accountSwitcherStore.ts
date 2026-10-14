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
  /**
   * 「添加账号」进行中:当前账号仍登着,同时进登录页登另一个号。根守卫平时会把
   * 已登录用户从 (auth) 页送回消息页,不放行的话「添加账号」一点就弹回聊天页。
   * (auth) 布局卸载时收回(useAddingAccountScope:登录成功退回 tabs,或用户返回放弃)。
   */
  addingAccount: boolean;
  open: () => void;
  close: () => void;
  setSwitching: (switching: boolean) => void;
  setAddingAccount: (addingAccount: boolean) => void;
}

export const useAccountSwitcherStore = create<AccountSwitcherState>((set) => ({
  isOpen: false,
  switching: false,
  addingAccount: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSwitching: (switching) => set({ switching }),
  setAddingAccount: (addingAccount) => set({ addingAccount }),
}));
