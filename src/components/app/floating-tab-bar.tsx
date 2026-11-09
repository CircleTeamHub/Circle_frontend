import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { CommonActions } from '@react-navigation/native';
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
import {
  circleBadgeAllowed,
  useCircleNotificationStore,
} from '@/features/discover/store/use-circle-notification-store';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { useAuthStore } from '@/stores/authStore';
import { useMembershipProgramStore } from '@/stores/membershipProgramStore';
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
import { PlaneLogoIcon } from '@/components/app/plane-logo-icon';
import { indicatorSlideStart } from '@/components/app/tab-indicator-track';

type IoniconName = keyof typeof Ionicons.glyphMap;

// 圈子 tab 用 App 自己的纸飞机标（PlaneLogoIcon），其余是 Ionicons 的描边/实心一对。
export type TabKey = {
  name: string;
  key: string;
} & (
  | { icon: 'plane-logo' }
  | { icon: IoniconName; selectedIcon: IoniconName }
);

export const TAB_KEYS: TabKey[] = [
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
  // 路由目录沿用 discover（圈子广场、圈子详情等深链都挂在它下面），显示为「圈子」。
  {
    name: 'discover',
    icon: 'plane-logo',
    key: 'tabs.circles',
  },
  {
    name: 'explore',
    icon: 'compass-outline',
    selectedIcon: 'compass',
    key: 'tabs.explore',
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
  explore: E2E_TEST_IDS.tabsExplore,
  profile: E2E_TEST_IDS.tabsProfile,
};

// —— bar 几何（全部自绘，不再受 React Navigation BottomTabItem 内层 padding 影响）——
// 比例照用户给的参考稿量出来(440pt 宽屏上):左边一条胶囊放常规 tab,右边一个和它
// 等高、中线对齐的独立圆按钮放圈子;左 20 / 间隔 16 / 右 16,下沿压在安全区上沿。
// 隐藏时把整条 bar 挪出屏幕：bar 高 + 底距 + 阴影余量。
const TAB_BAR_HIDDEN_OFFSET = 140;
const TAB_BAR_HEIGHT = 60;
const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2; // 整条 bar 是完整胶囊，两端半圆
const TAB_BAR_MARGIN_LEFT = 20;
const TAB_BAR_MARGIN_RIGHT = 16;
const TAB_FEATURED_GAP = 16; // bar 与右侧圆按钮之间
const TAB_BAR_MIN_BOTTOM = 12; // 没有 home indicator 安全区的机型离屏幕底的距离
const TAB_BAR_PAD_H = 5; // 内边距：选中底离 bar 内沿 5
const TAB_BAR_PAD_V = 5;
const TAB_PILL_HEIGHT = TAB_BAR_HEIGHT - TAB_BAR_PAD_V * 2;
const TAB_PILL_RADIUS = TAB_PILL_HEIGHT / 2; // 只裁剪单个 tab 的按压反馈，不绘制背景
const TAB_PILL_GAP = 0; // 选中底占满一格(参考稿的选中底就是整格宽)
const TAB_ICON_SIZE = 22;
// 圈子 tab 不进 bar:右侧独立圆按钮,和 bar 等高,一直是品牌紫渐变(与默认头像同一组)
// 配白色纸飞机,选中时纸飞机填实。
// 纸飞机按外框居中(小圆里眼睛比的是左右留白,按包络圆/重心左移实机看偏左),约占圆径一半。
const TAB_FEATURED_SIZE = TAB_BAR_HEIGHT;
const TAB_FEATURED_LOGO_SIZE = 30;
const BRAND_GRADIENT_STOPS = [
  { offset: '0', color: '#5548D9' },
  { offset: '0.52', color: '#7467F5' },
  { offset: '1', color: '#A58BFF' },
] as const;
// 磨砂靠材质散射，不靠纯色板。这两个数和材质档位是一组，一起决定"透多少"：
// systemThickMaterial + intensity 100 + alpha 0.5 曾经把透明度吃干净 ——
// Thick 是给 sheet/弹窗用的最厚材质，本身就接近不透明，三层叠上就成了实心板。
// 现在退回 Thin：保留磨砂扩散，但还看得出是块玻璃。
const TAB_BAR_BLUR_INTENSITY = 30;
const TAB_BAR_TINT_ALPHA = 0.06;
type TabBarStyles = {
  tabBarWrapper: ViewStyle;
  tabBarHidden: ViewStyle;
  tabBarRow: ViewStyle;
  tabBar: ViewStyle;
  tabBarBlurLayer: ViewStyle;
  tabBarTint: ViewStyle;
  tabItems: ViewStyle;
  tabItem: ViewStyle;
  pill: ViewStyle;
  liquidIndicator: ViewStyle;
  iconWrap: ViewStyle;
  featuredButton: ViewStyle;
  featuredGlow: ViewStyle;
  featuredSurface: ViewStyle;
  featuredFill: ViewStyle;
  featuredRim: ViewStyle;
  featuredBadge: ViewStyle;
  featuredDot: ViewStyle;
  badge: ViewStyle;
  badgeText: TextStyle;
  label: TextStyle;
  labelActive: TextStyle;
};

interface TabBarSurfaceProps {
  children: React.ReactNode;
  colorScheme: 'light' | 'dark';
  styles: TabBarStyles;
  /** 右侧圈子圆按钮复用同一种玻璃材质,只换外形。 */
  surfaceStyle?: StyleProp<ViewStyle>;
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
  styles,
  surfaceStyle,
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
          // GlassView 的子节点会被挂进原生玻璃的 contentView。把 BlurView
          // 或半透明 tint 再叠进去会盖住 UIGlassEffect，最终看起来像实心白板。
          // Liquid Glass 路径只让系统材质负责折射和透明度；BlurView 仅用于旧系统
          // fallback（见下方 iOS 分支）。
          style: 'clear',
          animate: false,
        }}
        style={[styles.tabBar, surfaceStyle]}
      >
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.tabBar, surfaceStyle]}>
        <TabBarFrostLayer colorScheme={colorScheme} styles={styles} />
        <View style={styles.tabBarTint} pointerEvents="none" />
        {children}
      </View>
    );
  }

  return <View style={[styles.tabBar, surfaceStyle]}>{children}</View>;
}

type BarTabKey = Extract<TabKey, { selectedIcon: IoniconName }>;
type FeaturedTabKey = Extract<TabKey, { icon: 'plane-logo' }>;

const isFeaturedTab = (tab: TabKey): tab is FeaturedTabKey => tab.icon === 'plane-logo';

interface TabSlotProps {
  tab: BarTabKey;
  label: string;
  focused: boolean;
  badgeCount: number;
  colors: ThemeColors;
  styles: TabBarStyles;
  onPress: () => void;
  accessibilityLabel: string;
  /** 深层页面上整条 bar 只是挪出屏幕：按钮必须同时退出键盘焦点、不可再被激活。 */
  hidden: boolean;
  testID?: string;
}

const TabSlot = memo(function TabSlot({
  tab,
  label,
  focused,
  badgeCount,
  colors,
  styles,
  onPress,
  accessibilityLabel,
  hidden,
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
      disabled={hidden}
      focusable={!hidden}
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
            {badgeCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1}>
                  {badgeCount > 99 ? '99+' : badgeCount}
                </Text>
              </View>
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

interface FeaturedTabButtonProps {
  focused: boolean;
  badgeCount: number;
  showUpdateDot: boolean;
  colors: ThemeColors;
  colorScheme: 'light' | 'dark';
  styles: TabBarStyles;
  onPress: () => void;
  accessibilityLabel: string;
  hidden: boolean;
  testID?: string;
}

// 右侧独立的圈子圆按钮:玻璃圆打底(和 bar 同一种材质,外圈 1pt 描边当亮边),上面一直
// 盖着品牌紫渐变。按用户要求选中后也保持紫色,不跟 bar 里的 tab 一样换色。
const FeaturedTabButton = memo(function FeaturedTabButton({
  focused,
  badgeCount,
  showUpdateDot,
  colors,
  colorScheme,
  styles,
  onPress,
  accessibilityLabel,
  hidden,
  testID,
}: FeaturedTabButtonProps) {
  const gradientId = `tab-featured-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const pressScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={hidden}
      focusable={!hidden}
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
      style={styles.featuredButton}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      <Animated.View style={[styles.featuredGlow, pressStyle]}>
        <TabBarSurface
          colorScheme={colorScheme}
          styles={styles}
          surfaceStyle={styles.featuredSurface}
        >
          {/* 用百分比画圆,总是内切在圆面里;圆面本身不带描边(见 featuredSurface)。 */}
          <Svg
            style={styles.featuredFill}
            width="100%"
            height="100%"
            pointerEvents="none"
          >
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                {BRAND_GRADIENT_STOPS.map((stop) => (
                  <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
                ))}
              </LinearGradient>
            </Defs>
            <Circle cx="50%" cy="50%" r="50%" fill={`url(#${gradientId})`} />
          </Svg>
          {/* 选中与否都保持紫色;选中时纸飞机填实,提示当前在圈子。 */}
          <PlaneLogoIcon size={TAB_FEATURED_LOGO_SIZE} color={colors.white} filled={focused} />
          <View pointerEvents="none" style={styles.featuredRim} />
        </TabBarSurface>
        {badgeCount > 0 ? (
          <View style={[styles.badge, styles.featuredBadge]}>
            <Text style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1}>
              {badgeCount > 99 ? '99+' : badgeCount}
            </Text>
          </View>
        ) : null}
        {showUpdateDot && badgeCount === 0 ? (
          <View testID="circle-plaza-update-dot" pointerEvents="none" style={styles.featuredDot} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
});

// 浮动 tab bar：深层页面保持隐藏，回到 tab 根页时直接显示，不制造入场动效。
// 内部整行自绘，每格 flex:1；选中态由 CustomTabBar 统一渲染液态指示器，点击时保留按压缩放。
function CustomTabBar({
  state,
  navigation,
  descriptors,
  hidden,
  colorScheme,
  colors,
  badgeMap,
  plazaDotVisible,
  styles,
}: BottomTabBarProps & {
  hidden: boolean;
  colorScheme: 'light' | 'dark';
  colors: ThemeColors;
  badgeMap: Record<string, number>;
  plazaDotVisible: boolean;
  styles: TabBarStyles;
}) {
  const { t } = useTranslation();
  const [tabItemsWidth, setTabItemsWidth] = useState(0);
  // 圈子不进 bar:bar 只排常规 tab,圈子单独画成右侧圆按钮。顺序仍按导航器的路由。
  const entries = state.routes.flatMap((route, routeIndex) => {
    const tab = TAB_BY_NAME[route.name];
    if (!tab) {
      devWarn(
        `[CustomTabBar] route "${route.name}" 未在 TAB_KEYS 中登记，已跳过该 tab。`,
      );
      return [];
    }
    return [{ route, routeIndex, tab }];
  });
  const barEntries = entries.flatMap(({ tab, ...rest }) =>
    isFeaturedTab(tab) ? [] : [{ ...rest, tab }],
  );
  const featuredEntry = entries.find(({ tab }) => isFeaturedTab(tab));
  // 选中底只在 bar 里移动;选中圈子时藏起来,位置停在上一个 tab,切回来从那里出发。
  const activeBarIndex = barEntries.findIndex(({ routeIndex }) => routeIndex === state.index);
  const barSlotCount = Math.max(barEntries.length, 1);
  const indicatorX = useSharedValue(TAB_PILL_GAP);
  const indicatorStretch = useSharedValue(1);
  const indicatorSquash = useSharedValue(1);
  const indicatorOpacity = useSharedValue(activeBarIndex < 0 ? 0 : 1);
  const previousIndex = useRef(activeBarIndex);
  // 这份 bar 已经滑过的那一笔(见 tab-indicator-track):起点按全局记,不按这份自己记的位置。
  const handledSlide = useRef(-1);
  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    transform: [
      { translateX: indicatorX.value },
      { scaleX: indicatorStretch.value },
      { scaleY: indicatorSquash.value },
    ],
  }));

  useEffect(() => {
    if (tabItemsWidth <= 0) return;
    const changedTab = previousIndex.current !== activeBarIndex;
    previousIndex.current = activeBarIndex;
    indicatorOpacity.value = withTiming(activeBarIndex < 0 ? 0 : 1, {
      duration: changedTab ? 160 : 0,
    });
    if (activeBarIndex < 0) return;
    const slotWidth = tabItemsWidth / barSlotCount;
    const targetX = activeBarIndex * slotWidth + TAB_PILL_GAP;
    // 每个 tab 首页各有一份 bar,这份记的位置可能是它上次被看见时的(甚至是失焦前挪到别的 tab 的),
    // 从那里滑会方向反了。从用户上一次看见指示器的那一格滑过来。
    const slideFrom = indicatorSlideStart(activeBarIndex, handledSlide, state.key);

    indicatorX.value =
      slideFrom === null
        ? withTiming(targetX, { duration: 0 })
        : withSequence(
            withTiming(slideFrom * slotWidth + TAB_PILL_GAP, { duration: 0 }),
            withTiming(targetX, {
              duration: 260,
              easing: Easing.out(Easing.cubic),
            }),
          );
    if (slideFrom !== null) {
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
  }, [
    activeBarIndex,
    barSlotCount,
    indicatorOpacity,
    indicatorSquash,
    indicatorStretch,
    indicatorX,
    state.key,
    tabItemsWidth,
  ]);

  const pressHandlerFor = (route: (typeof state.routes)[number], focused: boolean) => () => {
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
    <View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.tabBarWrapper, hidden && styles.tabBarHidden]}
      // 挪出屏幕 + 不接触摸还不够：读屏（iOS/Android）和网页键盘仍能聚焦到按钮，
      // 隐藏时把整条 bar 移出无障碍树。
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      aria-hidden={hidden}
    >
      <View style={styles.tabBarRow} pointerEvents="box-none">
        <TabBarSurface
          colorScheme={colorScheme}
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
                { width: Math.max(tabItemsWidth / barSlotCount - TAB_PILL_GAP * 2, 0) },
                indicatorStyle,
              ]}
            />
            {barEntries.map(({ route, routeIndex, tab }) => {
              const focused = state.index === routeIndex;
              const label = t(tab.key);
              return (
                <TabSlot
                  key={route.key}
                  tab={tab}
                  label={label}
                  focused={focused}
                  badgeCount={badgeMap[route.name] ?? 0}
                  colors={colors}
                  styles={styles}
                  onPress={pressHandlerFor(route, focused)}
                  accessibilityLabel={
                    descriptors[route.key].options.tabBarAccessibilityLabel ?? label
                  }
                  hidden={hidden}
                  testID={TAB_TEST_IDS[route.name]}
                />
              );
            })}
          </View>
        </TabBarSurface>
        {featuredEntry ? (
          <FeaturedTabButton
            focused={state.index === featuredEntry.routeIndex}
            badgeCount={badgeMap[featuredEntry.route.name] ?? 0}
            showUpdateDot={plazaDotVisible}
            colors={colors}
            colorScheme={colorScheme}
            styles={styles}
            onPress={pressHandlerFor(
              featuredEntry.route,
              state.index === featuredEntry.routeIndex,
            )}
            accessibilityLabel={
              descriptors[featuredEntry.route.key].options.tabBarAccessibilityLabel ??
              t(featuredEntry.tab.key)
            }
            hidden={hidden}
            testID={TAB_TEST_IDS[featuredEntry.route.name]}
          />
        ) : null}
      </View>
    </View>
  );
}

// 各 tab 汇总自己辖下的未读。路由布局（无障碍标签）和自绘 bar（红点）共用这一份口径。
export function useTabBadgeMap(): Record<string, number> {
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
      contactsUnread: state.contactsUnread + state.groupAdmissionsUnread,
      momentsUnread: state.momentsUnread,
      circleUnread: state.circleUnread,
      signupUnread: state.signupUnread,
      profileUnread: state.profileUnread,
    })));



  // 各 tab 汇总自己辖下的未读：圈子含圈子通知和报名管理，探索含朋友圈。
  // 曾经读的 discoverUnread 是「好友申请 + 朋友圈 + 圈子」的并集（互动消息
  // 列表页的全集口径），于是一条未读好友申请会同时点亮联系人和圈子两个
  // tab —— 而好友申请的规范 UI 是「新的朋友」，归联系人。
  const badgeMap: Record<string, number> = useMemo(() => ({
    messages: messagesUnread,
    contacts: contactsUnread,
    discover: circleUnread + signupUnread,
    explore: momentsUnread,
    profile: profileUnread,
  }), [
    messagesUnread,
    contactsUnread,
    momentsUnread,
    circleUnread,
    signupUnread,
    profileUnread,
  ]);

  return badgeMap;
}

// 飞机红点：圈子帖子列表有更新。跟圈子铃铛的未读一样受「圈子通知」总闸管。
export function useCirclePlazaDotVisible(): boolean {
  const hasUpdate = useTabBadgeStore((state) => state.circlePlazaHasUpdate);
  const allowed = useCircleNotificationStore(circleBadgeAllowed);
  // 列表接口已经说要开会员才能看：点进去只有升级墙，红点没有意义。
  const membershipRequired = useDiscoverStore((state) => state.plazaMembershipRequired);
  // 上面那个状态要等列表接口回过话，0 级用户冷启动时还是 false：先确认会员门槛没开才亮。
  const isLevelZero = useAuthStore((state) => (state.user?.vipLevel ?? 0) <= 0);
  const programEnabled = useMembershipProgramStore((state) => state.status?.enabled);
  const fetchProgramStatus = useMembershipProgramStore((state) => state.fetchStatus);
  const needsProgramStatus = hasUpdate && isLevelZero;
  useEffect(() => {
    if (needsProgramStatus) void fetchProgramStatus();
  }, [needsProgramStatus, fetchProgramStatus]);
  return hasUpdate && allowed && !membershipRequired && (!isLevelZero || programEnabled === false);
}

interface FloatingTabBarProps {
  tabProps: BottomTabBarProps;
  hidden: boolean;
}

// 浮动 tab bar 的唯一入口。原生端由各 tab 首页把它当作页面内容渲染
// （见 TabRootScreen），推入的页面会盖住它、返回时随首页一起滑回；
// Web 端仍由 Tabs 的 tabBar 作为全局浮层渲染。
export function FloatingTabBar({ tabProps, hidden }: FloatingTabBarProps) {
  const { colors, resolvedMode } = useTheme();
  const insets = useSafeAreaInsets();
  const activeRoute = tabProps.state.routes[tabProps.state.index];
  const tabBarStyle = StyleSheet.flatten(tabProps.descriptors[activeRoute.key].options.tabBarStyle);
  const hiddenByScreen = !!tabBarStyle && 'display' in tabBarStyle && tabBarStyle.display === 'none';
  // 桌面网页版分栏：所有 tab 共用同一个视口居中位置，避免消息页的导航
  // 因为左侧列表栏而和联系人、动态、我的页面错位。
  const isSplitLayout = useDesktopSplitLayout();
  // 左栏宽度用户可拖：浮动条与列表读同一个值，拖动时同帧一起变。
  const listPaneWidth = useSplitPaneStore((state) => state.listPaneWidth);
  const badgeMap = useTabBadgeMap();
  const plazaDotVisible = useCirclePlazaDotVisible();

  const styles = useMemo<TabBarStyles>(() => StyleSheet.create({
    // 底部锚定的全宽容器：absolute → 内容全幅延伸到浮动条之下；
    // 隐藏时同一个挂载实例瞬时挪出屏幕（不卸载、不做动画），回根页直接恢复。
    tabBarWrapper: {
      // Web 使用 fixed，避免浮动 bar 参与文档滚动区计算；原生使用 absolute。
      ...(Platform.OS === 'web'
        ? ({ position: 'fixed' } as unknown as ViewStyle)
        : ({ position: 'absolute' } as const)),
      left: 0,
      right: 0,
      bottom: 0,
      ...(isSplitLayout ? { alignItems: 'center' } : null),
    },
    // 隐藏只做瞬时位移、绝不改 opacity：GlassView / BlurView 的祖先 opacity
    // 归零会让系统停掉材质层，恢复成 1 时要重新生成材质，回到 tab 根页就会
    // 晚一拍才出现。挪出屏幕时材质一直在渲染，回来即刻可见。
    tabBarHidden: {
      transform: [{ translateY: TAB_BAR_HIDDEN_OFFSET }],
    },
    // 左边 bar(撑满剩余宽度)+ 右边圈子圆按钮,两者同高、中线对齐。
    tabBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      // 分栏时保持和左栏导航相同的宽度，只做水平居中，不随视口拉伸变形。
      ...(isSplitLayout
        ? { width: listPaneWidth - TAB_BAR_MARGIN_LEFT - TAB_BAR_MARGIN_RIGHT }
        : null),
      marginLeft: TAB_BAR_MARGIN_LEFT,
      marginRight: TAB_BAR_MARGIN_RIGHT,
      // 下沿压在 home indicator 安全区上沿;没有安全区的机型离屏幕底留一点。
      marginBottom: Math.max(insets.bottom, TAB_BAR_MIN_BOTTOM),
    },
    tabBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
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
    featuredButton: {
      marginLeft: TAB_FEATURED_GAP,
    },
    // 没选中时品牌紫的淡光晕,让它从玻璃上浮起来;只在 iOS 画(安卓 bar 是不透明 surface,
    // elevation 投影是灰的,叠上去反而脏)。
    featuredGlow: Platform.OS === 'ios'
      ? {
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: resolvedMode === 'dark' ? 0.55 : 0.35,
          shadowRadius: 10,
        }
      : {},
    // 复用 bar 的玻璃材质,只把外形换成等高的正圆(圆角 = bar 的圆角)。
    // 圆面不带布局描边:描边会把内容挤进 58×58,玻璃里的渐变圆就被裁掉右下一截(深色实机)。
    featuredSurface: {
      flex: 0,
      borderWidth: 0,
      width: TAB_FEATURED_SIZE,
      height: TAB_FEATURED_SIZE,
      borderRadius: TAB_FEATURED_SIZE / 2,
      paddingHorizontal: 0,
      paddingVertical: 0,
      justifyContent: 'center',
    },
    featuredFill: {
      ...StyleSheet.absoluteFillObject,
    },
    // 深色模式的亮边:盖在渐变之上的覆盖圈,不占布局;浅色不画。
    featuredRim: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: TAB_FEATURED_SIZE / 2,
      borderWidth: resolvedMode === 'light' ? 0 : 1,
      borderColor: Platform.OS === 'ios' ? 'rgba(255, 255, 255, 0.34)' : colors.surfaceBorder,
    },
    featuredBadge: {
      top: 0,
      right: 0,
    },
    // 贴在圆按钮右上弧线上的小红点：只表示「有更新」，不带数字。
    featuredDot: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.error,
      borderWidth: Platform.OS === 'ios' ? 0 : 2,
      borderColor: colors.surface,
    },
    badge: {
      position: 'absolute',
      top: -3,
      right: -14,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 3,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.error,
      // 这圈描边原本是为了融进 colors.surface 的 bar 底色；iOS 改成玻璃后
      // 底下没有固定色可融，留着只会变成浮在材质上的一圈实心光晕。
      borderWidth: Platform.OS === 'ios' ? 0 : 2,
      borderColor: colors.surface,
    },
    badgeText: {
      color: colors.white,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '600',
      includeFontPadding: false,
    },
    label: {
      fontSize: 10,
      fontWeight: '500',
      letterSpacing: 0.2,
    },
    labelActive: {
      fontWeight: '700',
    },
  }), [colors, insets.bottom, isSplitLayout, listPaneWidth, resolvedMode]);

  return (
    <CustomTabBar
      {...tabProps}
      hidden={hidden || hiddenByScreen}
      colorScheme={resolvedMode}
      colors={colors}
      badgeMap={badgeMap}
      plazaDotVisible={plazaDotVisible}
      styles={styles}
    />
  );
}
