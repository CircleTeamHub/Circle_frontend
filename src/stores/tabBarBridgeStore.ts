import { create } from 'zustand';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

/**
 * Tabs 导航器 → 各 tab 首页的桥。
 *
 * 原生端 tab bar 不再作为盖在整个导航栈之上的全局浮层，而是由每个 tab 的
 * 首页当作页面内容渲染：推入的页面直接盖住它，返回时它随首页一起滑回，
 * 跟系统 App 一样始终在场。全局浮层要靠导航状态切显隐，而状态更新晚于原生
 * 转场（手势返回要等动画结束才回调），于是回到首页总要等约半秒才冒出来。
 *
 * bar 需要导航器的 state/navigation/descriptors，而这些只在 Tabs 的 tabBar
 * 回调里拿得到，所以由路由布局把它们发布到这里，首页里的 bar 订阅读取。
 */
type TabBarBridgeState = {
  tabProps: BottomTabBarProps | null;
  /** 当前发布者。tabs 被重建时新旧两个桥会短暂并存。 */
  owner: symbol | null;
  publish: (owner: symbol, tabProps: BottomTabBarProps) => void;
  /** 只撤下自己发布的那份。 */
  unpublish: (owner: symbol) => void;
};

/**
 * 撤销必须认发布者:新桥在 layout effect 里发布,而被替换掉的旧桥的卸载清理是
 * passive effect,同一次提交里排在新桥发布**之后**执行。旧实现无条件置空,
 * 于是登录/切换账号后 bar 一直是空的,要等下一次导航状态变化重新发布才冒出来。
 */
export const useTabBarBridgeStore = create<TabBarBridgeState>((set, get) => ({
  tabProps: null,
  owner: null,
  publish: (owner, tabProps) => set({ owner, tabProps }),
  unpublish: (owner) => {
    if (get().owner !== owner) return;
    set({ owner: null, tabProps: null });
  },
}));
