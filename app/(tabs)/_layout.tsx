import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import {
  FloatingTabBar,
  TAB_KEYS,
  useTabBadgeMap,
} from '@/components/app/floating-tab-bar';
import { useTabBarBridgeStore } from '@/stores/tabBarBridgeStore';

// 原生端：tab bar 由各 tab 首页自己渲染（TabRootScreen），这里只把导航器
// props 发布出去，自身不画任何东西。深层页面不渲染 bar，因此无需显隐开关。
function TabBarBridge(props: BottomTabBarProps) {
  const publish = useTabBarBridgeStore((state) => state.publish);
  const unpublish = useTabBarBridgeStore((state) => state.unpublish);
  const [owner] = useState(() => Symbol('tab-bar-bridge'));
  // layout effect + useSyncExternalStore：同一帧内把新 state 同步给首页里的
  // bar，切 tab 时选中态不会落后一帧。
  useLayoutEffect(() => {
    publish(owner, props);
  });
  // 只撤下自己那份：tabs 重建时旧桥的清理晚于新桥发布,无条件置空会让 bar 消失。
  useEffect(() => () => unpublish(owner), [owner, unpublish]);
  return null;
}

export default function TabLayout() {
  const { t } = useTranslation();
  const segments = useSegments();
  // 仅 Web 使用：全局浮层在深层页面隐藏。
  const hideTabBar = segments.length > 2;
  const badgeMap = useTabBadgeMap();

  return (
    <Tabs
      tabBar={(props) =>
        Platform.OS === 'web' ? (
          <FloatingTabBar tabProps={props} hidden={hideTabBar} />
        ) : (
          <TabBarBridge {...props} />
        )
      }
      screenOptions={{
        // 看不见的页面冻结渲染(切走的 tab、栈里更深的页面),不再跟着每条消息重算。
        freezeOnBlur: true,
        headerShown: false,
      }}
    >
      {TAB_KEYS.map((tab) => {
        const label = t(tab.key);
        const badgeCount = badgeMap[tab.name] ?? 0;
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            listeners={({ navigation, route }) => ({
              // 点击 tab 始终回到该 tab 的首页（而非上次停留的子页面）：
              // 把该 tab 的内嵌栈 popToTop。无论当前是否在该 tab 都生效。
              tabPress: () => {
                const navState = navigation.getState();
                const tabRoute = navState.routes.find(
                  (r: { name: string }) => r.name === route.name,
                );
                const nested = tabRoute?.state as
                  | { key?: string; index?: number }
                  | undefined;
                if (nested?.key && (nested.index ?? 0) > 0) {
                  navigation.dispatch({
                    ...StackActions.popToTop(),
                    target: nested.key,
                  });
                }
              },
            })}
            options={{
              // 视觉文字由自绘 tab bar 渲染；这里只补屏幕阅读器标签（含未读提示）。
              tabBarAccessibilityLabel: badgeCount > 0
                ? `${label} ${t('tabs.unreadCount', { count: badgeCount })}`
                : label,
            }}
          />
        );
      })}
    </Tabs>
  );
}
