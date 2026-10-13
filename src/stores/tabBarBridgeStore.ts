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
  publish: (tabProps: BottomTabBarProps | null) => void;
};

export const useTabBarBridgeStore = create<TabBarBridgeState>((set) => ({
  tabProps: null,
  publish: (tabProps) => set({ tabProps }),
}));
