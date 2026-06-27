import React, { memo, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import {
  BottomTabBar,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/theme';

const TAB_KEYS: {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
}[] = [
  { name: 'messages', icon: 'chatbubble-outline', key: 'tabs.messages' },
  { name: 'contacts', icon: 'people-outline', key: 'tabs.contacts' },
  { name: 'discover', icon: 'play-circle-outline', key: 'tabs.discover' },
  { name: 'profile', icon: 'person-outline', key: 'tabs.profile' },
];

interface TabIconProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  focused: boolean;
  showBadgeDot: boolean;
  activeColor: string;
  inactiveColor: string;
  tabIconStyle: ViewStyle;
  tabIconActiveStyle: ViewStyle;
  tabIconBadgeStyle: ViewStyle;
  tabLabelStyle: TextStyle;
}

const TabIcon = memo(function TabIcon({
  icon,
  label,
  focused,
  showBadgeDot,
  activeColor,
  inactiveColor,
  tabIconStyle,
  tabIconActiveStyle,
  tabIconBadgeStyle,
  tabLabelStyle,
}: TabIconProps) {
  const color = focused ? activeColor : inactiveColor;

  return (
    <View style={[tabIconStyle, focused && tabIconActiveStyle]}>
      {showBadgeDot ? (
        // 红点的描边用于和背景"挖空"分隔：未选中时背景是 tab 栏(surface)，
        // 选中时背景是紫色 pill(primary)，否则会露出一圈深色描边。
        <View
          style={[
            tabIconBadgeStyle,
            focused && { borderColor: tabIconActiveStyle.backgroundColor },
          ]}
        />
      ) : null}
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[tabLabelStyle, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

// 隐藏时把整条 bar 向下滑出屏幕的距离（pill 高度 + 底部间距 + 余量）。
const TAB_BAR_HIDDEN_OFFSET = 140;
// bar 几何：常量与下面 tabBar 样式共用，pill 宽度按屏宽算出来「塞满」每一格。
const TAB_BAR_MARGIN_H = 40; // 左右外边距（保持原始 bar 尺寸，勿改）
const TAB_BAR_PADDING_H = 0; // 内边距设 0：首尾药丸贴到 bar 内沿
const TAB_PILL_GAP = 4; // 相邻药丸间距
// 滑入/滑出时长：偏短让返回主页时 bar 弹得更干脆。
const TAB_BAR_ANIM_DURATION = 200;
// ease-out：一开始就快速移动，避免默认 ease-in-out 慢启动造成的「延迟才弹」错觉。
const TAB_BAR_EASING = Easing.out(Easing.cubic);

// 浮动 tab bar 包装层：用 Reanimated 的 translateY+opacity 平滑滑入/滑出，
// 取代之前 display:none↔flex 的瞬间切换。瞬间切换会在“返回 tab 根页”时于 JS
// 状态提交那一刻立刻把浮动 bar 翻为可见，满不透明度地盖在仍在退场的详情页之上
// ——即用户看到的“闪一下”。改成动画后，bar 跟随转场平滑滑回，不再闪烁。
// 内部仍渲染真正的 BottomTabBar，保留原生 tab 行为、徽标与选中高亮。
function FloatingTabBar({
  hidden,
  wrapperStyle,
  ...props
}: BottomTabBarProps & { hidden: boolean; wrapperStyle: ViewStyle }) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(hidden ? TAB_BAR_HIDDEN_OFFSET : 0, {
          duration: TAB_BAR_ANIM_DURATION,
          easing: TAB_BAR_EASING,
        }),
      },
    ],
    opacity: withTiming(hidden ? 0 : 1, {
      duration: TAB_BAR_ANIM_DURATION,
      easing: TAB_BAR_EASING,
    }),
  }));

  return (
    // box-none：包装层本身（pill 周围的留白）不拦截触摸，放行给下方内容；
    // 隐藏时整体 none，避免滑出屏幕的 bar 仍捕获点击。
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[wrapperStyle, animatedStyle]}
    >
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const segments = useSegments();
  const hideTabBar = segments.length > 2;
  // 按屏宽算出每个高亮药丸的宽度，让它们填满整条 bar（首尾也顶到端头附近）。
  const { width: windowWidth } = useWindowDimensions();
  const tabSlotWidth =
    (windowWidth - TAB_BAR_MARGIN_H * 2 - 2 - TAB_BAR_PADDING_H * 2) /
    TAB_KEYS.length;
  const pillWidth = Math.max(56, Math.round(tabSlotWidth - TAB_PILL_GAP));
  const { messagesUnread, contactsUnread, discoverUnread, profileUnread } =
    useTabBadgeStore(useShallow((state) => ({
      messagesUnread: state.messagesUnread,
      contactsUnread: state.contactsUnread,
      discoverUnread: state.discoverUnread,
      profileUnread: state.profileUnread,
    })));

  const styles = useMemo(() => StyleSheet.create({
    // 底部锚定的全宽容器：absolute → 屏幕内容全幅延伸到 pill 之下（保持浮动效果）；
    // FloatingTabBar 对它做 translateY/opacity 动画。
    tabBarWrapper: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      bottom: 0,
    },
    tabBar: {
      backgroundColor: colors.surface,
      // 整圈描边：让浮动药丸在与背景同色调（尤其暗色模式）时也能看清边界。
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      height: 56,
      borderRadius: 28,
      marginHorizontal: TAB_BAR_MARGIN_H,
      marginBottom: 28,
      // 定位改由 tabBarWrapper 负责，这里保持在文档流内以便容器获得高度、
      // translateY 能正确带动整条 bar。
      position: 'relative' as const,
      paddingHorizontal: TAB_BAR_PADDING_H,
      paddingBottom: 0,
      shadowColor: colors.black,
      shadowOffset: {
        width: 0,
        height: 10,
      },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 10,
    },
    tabBarItem: {
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingTop: 6,
    },
    tabIcon: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      // 圆角=半高 → 选中高亮是完整胶囊（pill），左右全圆，和 tab 栏端头同款形状。
      borderRadius: 23,
      // 宽度按屏宽动态算（填满每格），见 pillWidth；高度保持在 bar 内不溢出。
      height: 46,
      gap: 2,
      position: 'relative' as const,
    },
    tabIconActive: {
      backgroundColor: colors.primary,
    },
    tabIconBadge: {
      position: 'absolute' as const,
      top: 6,
      right: 12,
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.error,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    tabLabel: {
      fontSize: 9,
      fontWeight: '500' as const,
      letterSpacing: 0.3,
    },
  }), [colors]);

  const badgeMap: Record<string, boolean> = useMemo(() => ({
    messages: messagesUnread > 0,
    contacts: contactsUnread > 0,
    discover: discoverUnread > 0,
    profile: profileUnread > 0,
  }), [messagesUnread, contactsUnread, discoverUnread, profileUnread]);

  return (
    <Tabs
      tabBar={(props) => (
        <FloatingTabBar
          {...props}
          hidden={hideTabBar}
          wrapperStyle={styles.tabBarWrapper}
        />
      )}
      screenOptions={{
        headerShown: false,
        // 始终用 pill 样式，可见性交给 FloatingTabBar 的动画（不再瞬间切 display）。
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
        tabBarItemStyle: styles.tabBarItem,
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
                const state = navigation.getState();
                const tabRoute = state.routes.find(
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
              // tabBarShowLabel:false 隐藏视觉文字 —— 但屏幕阅读器仍然需要标签。
              // 视觉 badge dot 由 TabIcon 内部用 showBadgeDot 渲染（不走 expo-router 的
              // tabBarBadge —— 那会额外画一个数字 badge）。a11y 这边把"有未读"也读出来。
              tabBarAccessibilityLabel: hasBadge
                ? `${label} ${t('tabs.unreadHint', { defaultValue: '有未读' })}`
                : label,
              tabBarIcon: ({ focused }) => (
                <TabIcon
                  icon={tab.icon}
                  label={label}
                  focused={focused}
                  showBadgeDot={hasBadge}
                  activeColor={colors.white}
                  inactiveColor={colors.textSecondary}
                  tabIconStyle={{ ...styles.tabIcon, width: pillWidth }}
                  tabIconActiveStyle={styles.tabIconActive}
                  tabIconBadgeStyle={styles.tabIconBadge}
                  tabLabelStyle={styles.tabLabel}
                />
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}
