import React, { memo, useCallback, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { FloatingTabBar } from '@/components/app/floating-tab-bar';
import { useTabBarBridgeStore } from '@/stores/tabBarBridgeStore';
import WebRoutePrefetch from './WebRoutePrefetch';

interface TabRootScreenProps {
  children: React.ReactNode;
}

// 切走的 tab 不卸载也不冻结：未读数一变 bridge 就重新发布 props，看不见的那几份 bar 不必跟着
// 重画，本 tab 前后都没被选中时跳过。
const TabBar = memo(FloatingTabBar, (prev, next) => !prev.active && !next.active);

/**
 * 本 tab 此刻是否被选中。每次渲染同步读导航状态：切 tab 时 bridge 在 layout effect 里发布、
 * 本组件同步重渲染，读到的已经是新状态，那一帧不会闪旧的选中态。另订阅本 tab 的 focus/blur：
 * 从根栈上的页面（如全局搜索）返回时 bridge 不会重新发布，靠它重新激活。
 */
function useTabSelected(): boolean {
  // 父级是 tab 导航器里装着本 tab 子栈的那个页面。
  const tabScreen = useNavigation().getParent();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!tabScreen) return () => {};
      const offFocus = tabScreen.addListener('focus', onChange);
      const offBlur = tabScreen.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [tabScreen],
  );
  const isSelected = () => tabScreen?.isFocused() ?? true;
  return useSyncExternalStore(subscribe, isSelected, isSelected);
}

function TabRootBar() {
  const tabProps = useTabBarBridgeStore((state) => state.tabProps);
  const selected = useTabSelected();
  if (!tabProps) return null;
  return <TabBar tabProps={tabProps} hidden={false} active={selected} />;
}

// tab 首页的外壳：原生端把浮动 tab bar 作为本页内容的一部分渲染，
// 深层页面推入时盖住它、返回时随首页一起出现，不存在「重新显示」的时机。
// Web 没有原生转场，桌面分栏还要跨栏居中，仍由 Tabs 的全局浮层负责。
export function TabRootScreen({ children }: TabRootScreenProps) {
  if (Platform.OS === 'web') return <>{children}<WebRoutePrefetch /></>;
  return (
    <View style={styles.fill}>
      {children}
      <TabRootBar />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
