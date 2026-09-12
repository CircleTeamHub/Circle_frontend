import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
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
import { useDesktopSplitLayout } from '@/hooks/use-desktop-split-layout';
import { useSplitPaneStore } from '@/stores/splitPaneStore';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme, withAlpha } from '@/theme';
import type { ThemeColors } from '@/theme/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { devWarn } from '@/utils/dev-log';

type TabKey = {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  selectedIcon: keyof typeof Ionicons.glyphMap;
  key: string;
};

const TAB_KEYS: TabKey[] = [
  {
    name: 'messages',
    icon: 'chatbubble-outline',
    selectedIcon: 'chatbubble',
    key: 'tabs.messages',
  },
  {
    name: 'contacts',
    icon: 'people-outline',
    selectedIcon: 'people',
    key: 'tabs.contacts',
  },
  {
    name: 'discover',
    icon: 'aperture-outline',
    selectedIcon: 'aperture',
    key: 'tabs.discover',
  },
  {
    name: 'profile',
    icon: 'person-outline',
    selectedIcon: 'person',
    key: 'tabs.profile',
  },
];

const TAB_BY_NAME: Record<string, TabKey> = Object.fromEntries(
  TAB_KEYS.map((tab) => [tab.name, tab]),
);

const TAB_TEST_IDS: Record<string, string> = {
  messages: E2E_TEST_IDS.tabsMessages,
  contacts: E2E_TEST_IDS.tabsContacts,
  discover: E2E_TEST_IDS.tabsDiscover,
  profile: E2E_TEST_IDS.tabsProfile,
};

// —— bar 几何（全部自绘，不再受 React Navigation BottomTabItem 内层 padding 影响）——
// 隐藏时把整条 bar 向下滑出屏幕：bar 高 + 底距 + 阴影余量。
const TAB_BAR_HIDDEN_OFFSET = 140;
const TAB_BAR_HEIGHT = 50;
const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2; // 整条 bar 是完整胶囊，两端半圆
const TAB_BAR_MARGIN_H = 32; // 左右外边距：再缩一圈后留白更多，bar 更窄
const TAB_BAR_MARGIN_B = 2; // 距安全区底部（浮动）
const TAB_BAR_SAFE_AREA_OVERLAP = 14; // 向下吃掉部分 iOS home indicator 安全区
const TAB_BAR_PAD_H = 4; // 内边距：首尾 tab 内容不贴 bar 内沿
const TAB_BAR_PAD_V = 4; // 上下内边距：tab 内容高 = bar 高 - 8
const TAB_PILL_HEIGHT = TAB_BAR_HEIGHT - TAB_BAR_PAD_V * 2;
const TAB_PILL_RADIUS = TAB_PILL_HEIGHT / 2; // 只裁剪单个 tab 的按压反馈，不绘制背景
const TAB_PILL_GAP = 2; // 每格 tab 左右留白，互不相贴
const TAB_ICON_SIZE = 18;
// 磨砂靠材质散射，不靠纯色板。这两个数和材质档位是一组，一起决定"透多少"：
// systemThickMaterial + intensity 100 + alpha 0.5 曾经把透明度吃干净 ——
// Thick 是给 sheet/弹窗用的最厚材质，本身就接近不透明，三层叠上就成了实心板。
// 现在退回 Thin：保留磨砂扩散，但还看得出是块玻璃。
const TAB_BAR_BLUR_INTENSITY = 30;
const TAB_BAR_TINT_ALPHA = 0.06;
// 滑入/滑出：偏短 + ease-out，返回主页时弹得干脆。
const TAB_BAR_ANIM_DURATION = 200;
const TAB_BAR_EASING = Easing.out(Easing.cubic);

type TabBarStyles = {
  tabBarWrapper: ViewStyle;
  tabBar: ViewStyle;
  tabBarBlurLayer: ViewStyle;
  tabBarTint: ViewStyle;
  tabItems: ViewStyle;
  tabItem: ViewStyle;
  pill: ViewStyle;
  liquidIndicator: ViewStyle;
  iconWrap: ViewStyle;
  badge: ViewStyle;
  label: TextStyle;
  labelActive: TextStyle;
};

interface TabBarSurfaceProps {
  children: React.ReactNode;
  colorScheme: 'light' | 'dark';
  hidden: boolean;
  styles: TabBarStyles;
}

// 两条 iOS 路径共用的磨砂层。抽出来是为了让 iOS 26（玻璃 + 磨砂）和
// iOS 17/18（仅磨砂）用的是同一档材质与强度，观感不分裂。
function TabBarFrostLayer({
  colorScheme,
  styles,
}: {
  colorScheme: 'light' | 'dark';
  styles: TabBarStyles;
}) {
  return (
    <BlurView
      intensity={TAB_BAR_BLUR_INTENSITY}
      // 应用允许主题与系统外观不同；自适应的 systemThickMaterial 只跟随系统，
      // 可能把暗色主题的白字放到浅色材质上。必须跟随 resolvedMode。
      tint={colorScheme === 'dark' ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
      style={styles.tabBarBlurLayer}
    />
  );
}

function TabBarSurface({
  children,
  colorScheme,
  hidden,
  styles,
}: TabBarSurfaceProps) {
  // GlassView 在旧系统上只是普通 View，显式使用 BlurView 才能让 iOS 18/17
  // 也保留 Squady 式的半透明导航材质。API 可用性检查同时规避早期 iOS 26
  // beta 上实例化 GlassView 会崩溃的问题。
  const canRenderLiquidGlass =
    Platform.OS === 'ios' &&
    isGlassEffectAPIAvailable() &&
    isLiquidGlassAvailable();

  if (canRenderLiquidGlass) {
    return (
      <GlassView
        colorScheme={colorScheme}
        glassEffectStyle={{
          style: hidden ? 'none' : 'regular',
          animate: true,
          animationDuration: TAB_BAR_ANIM_DURATION / 1000,
        }}
        style={styles.tabBar}
      >
        {/* GlassView 只有 clear/regular/none，液态玻璃偏清透折射、没有磨砂强度
            可调。要磨砂就得在玻璃之上自己叠一层材质，否则 iOS 26 和旧系统
            会长成两种东西。 */}
        <TabBarFrostLayer colorScheme={colorScheme} styles={styles} />
        <View style={styles.tabBarTint} pointerEvents="none" />
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.tabBar}>
        <TabBarFrostLayer colorScheme={colorScheme} styles={styles} />
        <View style={styles.tabBarTint} pointerEvents="none" />
        {children}
      </View>
    );
  }

  return <View style={styles.tabBar}>{children}</View>;
}

interface TabSlotProps {
  tab: TabKey;
  label: string;
  focused: boolean;
  showBadgeDot: boolean;
  colors: ThemeColors;
  styles: TabBarStyles;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
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
  testID,
}: TabSlotProps) {
  const pressScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  const iconTint = focused ? colors.tabBarActive : colors.textSecondary;
  const labelTint = focused ? colors.tabBarActive : colors.textSecondary;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onPressIn={() => {
        pressScale.value = withSpring(0.92, {
          damping: 18,
          stiffness: 420,
          mass: 0.45,
          reduceMotion: ReduceMotion.System,
        });
      }}
      onPressOut={() => {
        pressScale.value = withSpring(1, {
          damping: 13,
          stiffness: 340,
          mass: 0.5,
          reduceMotion: ReduceMotion.System,
        });
      }}
      style={styles.tabItem}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.pill,
            pressStyle,
            pressed && Platform.OS !== 'ios' && { opacity: 0.7 },
          ]}
        >
          <View style={styles.iconWrap}>
            <Ionicons
              name={focused ? tab.selectedIcon : tab.icon}
              size={focused ? TAB_ICON_SIZE + 1 : TAB_ICON_SIZE}
              color={iconTint}
            />
            {showBadgeDot ? (
              <View style={styles.badge} />
            ) : null}
          </View>
          <Text
            style={[
              styles.label,
              focused && styles.labelActive,
              { color: labelTint },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
});

// 浮动 tab bar：Reanimated translateY+opacity 平滑滑入/滑出（取代 display 瞬切，
// 消除「返回 tab 根页时浮动条闪一下」）。内部整行自绘，每格 flex:1，
// 选中态由 CustomTabBar 统一渲染液态指示器；点击时每格仍保留自己的按压缩放。
function CustomTabBar({
  state,
  navigation,
  descriptors,
  hidden,
  colorScheme,
  colors,
  badgeMap,
  styles,
}: BottomTabBarProps & {
  hidden: boolean;
  colorScheme: 'light' | 'dark';
  colors: ThemeColors;
  badgeMap: Record<string, boolean>;
  styles: TabBarStyles;
}) {
  const { t } = useTranslation();
  const [tabItemsWidth, setTabItemsWidth] = useState(0);
  const activeIndex = state.index;
  const indicatorX = useSharedValue(TAB_PILL_GAP);
  const indicatorStretch = useSharedValue(1);
  const indicatorSquash = useSharedValue(1);
  const previousIndex = useRef(activeIndex);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: indicatorX.value },
      { scaleX: indicatorStretch.value },
      { scaleY: indicatorSquash.value },
    ],
  }));

  useEffect(() => {
    if (tabItemsWidth <= 0) return;
    const slotWidth = tabItemsWidth / Math.max(state.routes.length, 1);
    const targetX = activeIndex * slotWidth + TAB_PILL_GAP;
    const changedTab = previousIndex.current !== activeIndex;

    indicatorX.value = withTiming(targetX, {
      duration: changedTab ? 260 : 0,
      easing: Easing.out(Easing.cubic),
    });
    if (changedTab) {
      // 拉长 + 压扁的短暂形变让胶囊看起来像一滴液体跳到下一个 tab，
      // 再用弹簧恢复成稳定的圆角胶囊。
      indicatorStretch.value = withSequence(
        withTiming(1.32, {
          duration: 90,
          easing: Easing.out(Easing.cubic),
        }),
        withSpring(1, {
          damping: 12,
          stiffness: 220,
          mass: 0.5,
          reduceMotion: ReduceMotion.System,
        }),
      );
      indicatorSquash.value = withSequence(
        withTiming(0.84, {
          duration: 90,
          easing: Easing.out(Easing.cubic),
        }),
        withSpring(1, {
          damping: 12,
          stiffness: 220,
          mass: 0.5,
          reduceMotion: ReduceMotion.System,
        }),
      );
    }
    previousIndex.current = activeIndex;
  }, [activeIndex, indicatorSquash, indicatorStretch, indicatorX, state.routes.length, tabItemsWidth]);

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
    // GlassView 的父级 opacity < 1 会让系统折射层停止渲染。iOS 仅做位移，
    // 其它平台保留原有淡出；移出屏幕后 pointerEvents 已禁用。
    opacity: Platform.OS === 'ios' ? 1 : 1 - hiddenProgress.value,
  }));

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.tabBarWrapper, animatedStyle]}
    >
      <TabBarSurface
        colorScheme={colorScheme}
        hidden={hidden}
        styles={styles}
      >
        <View
          style={styles.tabItems}
          onLayout={(event) => setTabItemsWidth(event.nativeEvent.layout.width)}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.liquidIndicator,
              {
                width: Math.max(
                  tabItemsWidth / Math.max(state.routes.length, 1) - TAB_PILL_GAP * 2,
                  0,
                ),
              },
              indicatorStyle,
            ]}
          />
          {state.routes.map((route, index) => {
            const tab = TAB_BY_NAME[route.name];
            if (!tab) {
              devWarn(
                `[CustomTabBar] route "${route.name}" 未在 TAB_KEYS 中登记，已跳过该 tab。`,
              );
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
              // 个人中心是一个独立 Stack。直接点击“我的”必须回到
              // profile/index，而不是把上次停留的商城/设置页带回来。
              // 这里直接针对嵌套 Stack 做 reset，避免父级 navigate(merge)
              // 恢复上次停留的 mall 页面。
              const nested = route.state as
                | { key?: string; index?: number }
                | undefined;
              if (route.name === 'profile' && nested?.key) {
                navigation.dispatch({
                  ...CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'index' }],
                  }),
                  target: nested.key,
                });
              }
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
                testID={TAB_TEST_IDS[route.name]}
              />
            );
          })}
        </View>
      </TabBarSurface>
    </Animated.View>
  );
}

export default function TabLayout() {
  const { colors, resolvedMode } = useTheme();
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
  // 左栏宽度用户可拖：浮动条与列表读同一个值，拖动时同帧一起变。
  const listPaneWidth = useSplitPaneStore((state) => state.listPaneWidth);

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
          ? { right: undefined, width: listPaneWidth }
          : { alignItems: 'center' }
        : null),
    },
    tabBar: {
      flexDirection: 'row',
      alignItems: 'center',
      // 居中模式下 wrapper 不再限宽，tab 内容给固定宽（与左栏模式同宽，只
      // 平移不变形）。
      ...(isSplitLayout && !pinTabBarLeft
        ? { width: listPaneWidth - TAB_BAR_MARGIN_H * 2 }
        : null),
      height: TAB_BAR_HEIGHT,
      borderRadius: TAB_BAR_RADIUS,
      // iOS 的底色必须透明，才能让 GlassView / BlurView 采样下方内容；
      // Android/Web 仍使用原来的不透明 surface，避免低端设备额外合成开销。
      backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.surface,
      borderWidth: 1,
      borderColor:
        Platform.OS === 'ios'
          ? resolvedMode === 'dark'
            ? 'rgba(255, 255, 255, 0.34)'
            : 'rgba(0, 0, 0, 0.12)'
          : colors.surfaceBorder,
      marginHorizontal: TAB_BAR_MARGIN_H,
      marginBottom: TAB_BAR_MARGIN_B + Math.max(insets.bottom - TAB_BAR_SAFE_AREA_OVERLAP, 0),
      paddingHorizontal: TAB_BAR_PAD_H,
      paddingVertical: TAB_BAR_PAD_V,
      // 不裁剪：阴影完整显示，且 tab 内容本就在内部不会溢出。
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 10,
    },
    // UIVisualEffectView 的圆角只有在 clipsToBounds 打开时才生效，而 tabBar
    // 本身刻意不裁剪（要留完整投影）。所以模糊层自己铺一张绝对定位背景、
    // 自己裁成胶囊；否则 iOS 26 以下整条 bar 会渲染成硬边矩形。
    tabBarBlurLayer: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: TAB_BAR_RADIUS,
      overflow: 'hidden',
    },
    // 玻璃/模糊之上的半透明底色，压住透穿的内容。和 tabBarBlurLayer 一样
    // 自己带圆角 —— tabBar 刻意不裁剪（要留完整投影），指望父级裁不到。
    tabBarTint: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: TAB_BAR_RADIUS,
      backgroundColor: withAlpha(colors.surface, TAB_BAR_TINT_ALPHA),
    },
    // 每格等宽：flex:1 平分整条 bar，液态指示器在同一层横向移动。
    tabItems: {
      flex: 1,
      flexDirection: 'row',
      position: 'relative',
    },
    tabItem: {
      flex: 1,
      justifyContent: 'center',
      zIndex: 1,
    },
    pill: {
      height: TAB_PILL_HEIGHT,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TAB_PILL_RADIUS,
      marginHorizontal: TAB_PILL_GAP,
      overflow: 'hidden',
      position: 'relative',
      gap: 2,
    },
    liquidIndicator: {
      position: 'absolute',
      top: 0,
      left: 0,
      height: TAB_PILL_HEIGHT,
      borderRadius: TAB_PILL_RADIUS,
      backgroundColor:
        resolvedMode === 'dark'
          ? 'rgba(0, 0, 0, 0.24)'
          : 'rgba(0, 0, 0, 0.08)',
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
      // 这圈描边原本是为了融进 colors.surface 的 bar 底色；iOS 改成玻璃后
      // 底下没有固定色可融，留着只会变成浮在材质上的一圈实心光晕。
      borderWidth: Platform.OS === 'ios' ? 0 : 2,
      borderColor: colors.surface,
    },
    label: {
      fontSize: 9,
      fontWeight: '500',
      letterSpacing: 0.2,
    },
    labelActive: {
      fontWeight: '700',
    },
  }), [colors, insets.bottom, isSplitLayout, listPaneWidth, pinTabBarLeft, resolvedMode]);

  // 动态 tab 只统计它自己辖下的三样：朋友圈铃铛 + 圈子铃铛 + 报名管理。
  // 曾经读的 discoverUnread 是「好友申请 + 朋友圈 + 圈子」的并集（互动消息
  // 列表页的全集口径），于是一条未读好友申请会同时点亮联系人和动态两个
  // tab —— 而好友申请的规范 UI 是「新的朋友」，归联系人。
  const badgeMap: Record<string, boolean> = useMemo(() => ({
    messages: messagesUnread > 0,
    contacts: contactsUnread > 0 || momentsUnread > 0,
    discover: circleUnread > 0 || signupUnread > 0,
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
          colorScheme={resolvedMode}
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
