import React, { memo, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Platform,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { CommonActions, StackActions } from '@react-navigation/native';
import { type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  SPLIT_LIST_PANE_WIDTH,
  useDesktopSplitLayout,
} from '@/hooks/use-desktop-split-layout';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/theme';
import type { ThemeColors } from '@/theme/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TabKey = {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
};

const TAB_KEYS: TabKey[] = [
  { name: 'messages', icon: 'chatbubble-outline', key: 'tabs.messages' },
  { name: 'contacts', icon: 'people-outline', key: 'tabs.contacts' },
  { name: 'discover', icon: 'aperture-outline', key: 'tabs.discover' },
  { name: 'profile', icon: 'person-outline', key: 'tabs.profile' },
];

const TAB_BY_NAME: Record<string, TabKey> = Object.fromEntries(
  TAB_KEYS.map((tab) => [tab.name, tab]),
);

// —— bar 几何（全部自绘，不再受 React Navigation BottomTabItem 内层 padding 影响）——
// 隐藏时把整条 bar 向下滑出屏幕：bar 高 + 底距 + 阴影余量。
const TAB_BAR_HIDDEN_OFFSET = 140;
const TAB_BAR_HEIGHT = 50;
const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2; // 整条 bar 是完整胶囊，两端半圆
const TAB_BAR_MARGIN_H = 32; // 左右外边距：再缩一圈后留白更多，bar 更窄
const TAB_BAR_MARGIN_B = 2; // 距安全区底部（浮动）
const TAB_BAR_SAFE_AREA_OVERLAP = 14; // 向下吃掉部分 iOS home indicator 安全区
const TAB_BAR_PAD_H = 4; // 内边距：首尾药丸不贴 bar 内沿
const TAB_BAR_PAD_V = 4; // 上下内边距：药丸高 = bar 高 - 8
const TAB_PILL_HEIGHT = TAB_BAR_HEIGHT - TAB_BAR_PAD_V * 2;
const TAB_PILL_RADIUS = TAB_PILL_HEIGHT / 2; // 选中药丸：和 tab bar 一样是完整胶囊形状
const TAB_PILL_GAP = 2; // 每格药丸左右留白，互不相贴
const TAB_ICON_SIZE = 18;
// 滑入/滑出：偏短 + ease-out，返回主页时弹得干脆。
const TAB_BAR_ANIM_DURATION = 200;
const TAB_BAR_EASING = Easing.out(Easing.cubic);

type TabBarStyles = {
  tabBarWrapper: ViewStyle;
  tabBar: ViewStyle;
  tabItem: ViewStyle;
  pill: ViewStyle;
  activePillFill: ViewStyle;
  iconWrap: ViewStyle;
  badge: ViewStyle;
  label: TextStyle;
};

interface TabSlotProps {
  tab: TabKey;
  label: string;
  focused: boolean;
  showBadgeDot: boolean;
  colors: ThemeColors;
  styles: TabBarStyles;
  onPress: () => void;
  accessibilityLabel: string;
}

const TabSlot = memo(function TabSlot({
  tab,
  label,
  focused,
  showBadgeDot,
  colors,
  styles,
  onPress,
  accessibilityLabel,
}: TabSlotProps) {
  const tint = focused ? colors.white : colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={styles.tabItem}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.pill,
            pressed && { opacity: 0.7 },
          ]}
        >
          {focused ? <View style={styles.activePillFill} /> : null}
          <View style={styles.iconWrap}>
            <Ionicons name={tab.icon} size={TAB_ICON_SIZE} color={tint} />
            {showBadgeDot ? (
              // 红点描边：未选中时混入 bar(surface)，选中时混入紫色药丸(primary)，
              // 否则会在彩色背景上露出一圈异色描边。
              <View
                style={[
                  styles.badge,
                  focused && { borderColor: colors.primary },
                ]}
              />
            ) : null}
          </View>
          <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

// 浮动 tab bar：Reanimated translateY+opacity 平滑滑入/滑出（取代 display 瞬切，
// 消除「返回 tab 根页时浮动条闪一下」）。内部整行自绘，每格 flex:1，
// 选中药丸填满本格 → 不溢出、无缝隙、对齐精确。
function CustomTabBar({
  state,
  navigation,
  descriptors,
  hidden,
  colors,
  badgeMap,
  styles,
}: BottomTabBarProps & {
  hidden: boolean;
  colors: ThemeColors;
  badgeMap: Record<string, boolean>;
  styles: TabBarStyles;
}) {
  const { t } = useTranslation();

  // 把 hidden 这个普通 prop 镜像进 shared value 再驱动动画：worklet 依赖被追踪的
  // shared value，而非闭包捕获的 JS prop——即使将来 CustomTabBar 被 memo 化、
  // 父级不再随 segment 重渲染，显隐动画也不会失效。
  const hiddenProgress = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    hiddenProgress.value = withTiming(hidden ? 1 : 0, {
      duration: TAB_BAR_ANIM_DURATION,
      easing: TAB_BAR_EASING,
    });
  }, [hidden, hiddenProgress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: hiddenProgress.value * TAB_BAR_HIDDEN_OFFSET },
    ],
    opacity: 1 - hiddenProgress.value,
  }));

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.tabBarWrapper, animatedStyle]}
    >
      <View style={styles.tabBar}>
        {state.routes.map((route, index) => {
          const tab = TAB_BY_NAME[route.name];
          if (!tab) {
            if (__DEV__) {
              console.warn(
                `[CustomTabBar] route "${route.name}" 未在 TAB_KEYS 中登记，已跳过该 tab。`,
              );
            }
            return null;
          }

          const focused = state.index === index;
          const label = t(tab.key);
          const hasBadge = badgeMap[route.name] ?? false;
          const { options } = descriptors[route.key];

          const onPress = () => {
            // 先发 tabPress：触发 Tabs.Screen 上的 listener（把该 tab 的内嵌栈
            // popToTop，实现「点 tab 永远回首页」）。再在未聚焦时切换到该 tab。
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({
                ...CommonActions.navigate({ name: route.name, merge: true }),
                target: state.key,
              });
            }
          };

          return (
            <TabSlot
              key={route.key}
              tab={tab}
              label={label}
              focused={focused}
              showBadgeDot={hasBadge}
              colors={colors}
              styles={styles}
              onPress={onPress}
              accessibilityLabel={
                options.tabBarAccessibilityLabel ?? label
              }
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const hideTabBar = segments.length > 2;
  // 桌面网页版分栏：浮动条钉进左栏（会话列表）宽度内，变成列表的底部导航，
  // 不再横贯整窗、压住右栏聊天输入框。
  const isSplitLayout = useDesktopSplitLayout();
  // 分栏时浮动条的落点跟着当前 tab 走：消息 tab 钉进左栏（它就是列表栏的
  // 底部导航）；其余 tab 的内容在 640 居中窄栏里，浮动条也居中同轴。
  const pinTabBarLeft =
    isSplitLayout && (segments[1] ?? 'messages') === 'messages';

  const {
    messagesUnread,
    contactsUnread,
    momentsUnread,
    circleUnread,
    signupUnread,
    profileUnread,
  } =
    useTabBadgeStore(useShallow((state) => ({
      messagesUnread: state.messagesUnread,
      contactsUnread: state.contactsUnread,
      momentsUnread: state.momentsUnread,
      circleUnread: state.circleUnread,
      signupUnread: state.signupUnread,
      profileUnread: state.profileUnread,
    })));

  const styles = useMemo<TabBarStyles>(() => StyleSheet.create({
    // 底部锚定的全宽容器：absolute → 内容全幅延伸到浮动条之下；
    // CustomTabBar 对它做 translateY/opacity 动画。
    tabBarWrapper: {
      // Web 用 fixed:隐藏时的 translateY(140) 会把 absolute 元素撑进祖先的
      // 滚动区(body.scrollHeight 变成 视口+140),浏览器聚焦输入框时的程序化
      // 滚动就把整页带下去 140px —— 顶部导航被吃掉、且因为 overflow:hidden
      // 用户还滚不回来。fixed 元素不参与祖先滚动区计算,从源头掐断。
      // 原生不认 'fixed',保持 absolute。
      ...(Platform.OS === 'web'
        ? ({ position: 'fixed' } as unknown as ViewStyle)
        : ({ position: 'absolute' } as const)),
      left: 0,
      right: 0,
      bottom: 0,
      ...(isSplitLayout
        ? pinTabBarLeft
          ? { right: undefined, width: SPLIT_LIST_PANE_WIDTH }
          : { alignItems: 'center' }
        : null),
    },
    tabBar: {
      flexDirection: 'row',
      alignItems: 'center',
      // 居中模式下 wrapper 不再限宽，药丸给固定宽（与左栏模式同宽，只
      // 平移不变形）。
      ...(isSplitLayout && !pinTabBarLeft
        ? { width: SPLIT_LIST_PANE_WIDTH - TAB_BAR_MARGIN_H * 2 }
        : null),
      height: TAB_BAR_HEIGHT,
      borderRadius: TAB_BAR_RADIUS,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginHorizontal: TAB_BAR_MARGIN_H,
      marginBottom: TAB_BAR_MARGIN_B + Math.max(insets.bottom - TAB_BAR_SAFE_AREA_OVERLAP, 0),
      paddingHorizontal: TAB_BAR_PAD_H,
      paddingVertical: TAB_BAR_PAD_V,
      // 不裁剪：阴影完整显示，且药丸本就在内部不会溢出。
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 10,
    },
    // 每格等宽：flex:1 平分整条 bar，选中药丸填满本格 → 不溢出、不留缝。
    tabItem: {
      flex: 1,
      justifyContent: 'center',
    },
    pill: {
      height: TAB_PILL_HEIGHT,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TAB_PILL_RADIUS,
      marginHorizontal: TAB_PILL_GAP,
      overflow: 'hidden',
      gap: 2,
    },
    activePillFill: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: TAB_PILL_RADIUS,
      backgroundColor: colors.primary,
    },
    iconWrap: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: -3,
      right: -7,
      width: 11,
      height: 11,
      borderRadius: 999,
      backgroundColor: colors.error,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    label: {
      fontSize: 9,
      fontWeight: '500',
      letterSpacing: 0.2,
    },
  }), [colors, insets.bottom, isSplitLayout, pinTabBarLeft]);

  // 动态 tab 只统计它自己辖下的三样：朋友圈铃铛 + 圈子铃铛 + 报名管理。
  // 曾经读的 discoverUnread 是「好友申请 + 朋友圈 + 圈子」的并集（互动消息
  // 列表页的全集口径），于是一条未读好友申请会同时点亮联系人和动态两个
  // tab —— 而好友申请的规范 UI 是「新的朋友」，归联系人。
  const badgeMap: Record<string, boolean> = useMemo(() => ({
    messages: messagesUnread > 0,
    contacts: contactsUnread > 0,
    discover: momentsUnread > 0 || circleUnread > 0 || signupUnread > 0,
    profile: profileUnread > 0,
  }), [
    messagesUnread,
    contactsUnread,
    momentsUnread,
    circleUnread,
    signupUnread,
    profileUnread,
  ]);

  return (
    <Tabs
      tabBar={(props) => (
        <CustomTabBar
          {...props}
          hidden={hideTabBar}
          colors={colors}
          badgeMap={badgeMap}
          styles={styles}
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      {TAB_KEYS.map((tab) => {
        const label = t(tab.key);
        const hasBadge = badgeMap[tab.name] ?? false;
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
              tabBarAccessibilityLabel: hasBadge
                ? `${label} ${t('tabs.unreadHint', { defaultValue: '有未读' })}`
                : label,
            }}
          />
        );
      })}
    </Tabs>
  );
}
