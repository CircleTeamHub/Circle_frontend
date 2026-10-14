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

export type TabKey = {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  selectedIcon: keyof typeof Ionicons.glyphMap;
  key: string;
};

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
// 隐藏时把整条 bar 挪出屏幕：bar 高 + 底距 + 阴影余量。
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
type TabBarStyles = {
  tabBarWrapper: ViewStyle;
  tabBarHidden: ViewStyle;
  tabBar: ViewStyle;
  tabBarBlurLayer: ViewStyle;
  tabBarTint: ViewStyle;
  tabItems: ViewStyle;
  tabItem: ViewStyle;
  pill: ViewStyle;
  liquidIndicator: ViewStyle;
  iconWrap: ViewStyle;
  badge: ViewStyle;
  badgeText: TextStyle;
  label: TextStyle;
  labelActive: TextStyle;
};

interface TabBarSurfaceProps {
  children: React.ReactNode;
  colorScheme: 'light' | 'dark';
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
          style: 'regular',
          animate: false,
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
  styles,
}: BottomTabBarProps & {
  hidden: boolean;
  colorScheme: 'light' | 'dark';
  colors: ThemeColors;
  badgeMap: Record<string, number>;
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
            const badgeCount = badgeMap[route.name] ?? 0;
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
                badgeCount={badgeCount}
                colors={colors}
                styles={styles}
                onPress={onPress}
                accessibilityLabel={
                  options.tabBarAccessibilityLabel ?? label
                }
                hidden={hidden}
                testID={TAB_TEST_IDS[route.name]}
              />
            );
          })}
        </View>
      </TabBarSurface>
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



  // 各 tab 汇总自己辖下的未读：联系人含朋友圈，动态含圈子和报名管理。
  // 曾经读的 discoverUnread 是「好友申请 + 朋友圈 + 圈子」的并集（互动消息
  // 列表页的全集口径），于是一条未读好友申请会同时点亮联系人和动态两个
  // tab —— 而好友申请的规范 UI 是「新的朋友」，归联系人。
  const badgeMap: Record<string, number> = useMemo(() => ({
    messages: messagesUnread,
    contacts: contactsUnread + momentsUnread,
    discover: circleUnread + signupUnread,
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
  // 桌面网页版分栏：所有 tab 共用同一个视口居中位置，避免消息页的导航
  // 因为左侧列表栏而和联系人、动态、我的页面错位。
  const isSplitLayout = useDesktopSplitLayout();
  // 左栏宽度用户可拖：浮动条与列表读同一个值，拖动时同帧一起变。
  const listPaneWidth = useSplitPaneStore((state) => state.listPaneWidth);
  const badgeMap = useTabBadgeMap();

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
    tabBar: {
      flexDirection: 'row',
      alignItems: 'center',
      // 分栏时保持和左栏导航相同的宽度，只做水平居中，不随视口拉伸变形。
      ...(isSplitLayout
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
      fontSize: 9,
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
      hidden={hidden}
      colorScheme={resolvedMode}
      colors={colors}
      badgeMap={badgeMap}
      styles={styles}
    />
  );
}
