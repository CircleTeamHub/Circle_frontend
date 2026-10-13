import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { FloatingTabBar } from '@/components/app/floating-tab-bar';
import { useTabBarBridgeStore } from '@/stores/tabBarBridgeStore';

interface TabRootScreenProps {
  children: React.ReactNode;
}

function TabRootBar() {
  const tabProps = useTabBarBridgeStore((state) => state.tabProps);
  if (!tabProps) return null;
  return <FloatingTabBar tabProps={tabProps} hidden={false} />;
}

// tab 首页的外壳：原生端把浮动 tab bar 作为本页内容的一部分渲染，
// 深层页面推入时盖住它、返回时随首页一起出现，不存在「重新显示」的时机。
// Web 没有原生转场，桌面分栏还要跨栏居中，仍由 Tabs 的全局浮层负责。
export function TabRootScreen({ children }: TabRootScreenProps) {
  if (Platform.OS === 'web') return <>{children}</>;
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
