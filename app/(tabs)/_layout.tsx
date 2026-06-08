import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme, Spacing, Radius } from '@/theme';

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

export default function TabLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const segments = useSegments();
  const hideTabBar = segments.length > 2;
  const { messagesUnread, contactsUnread, discoverUnread, profileUnread } =
    useTabBadgeStore(useShallow((state) => ({
      messagesUnread: state.messagesUnread,
      contactsUnread: state.contactsUnread,
      discoverUnread: state.discoverUnread,
      profileUnread: state.profileUnread,
    })));

  const styles = useMemo(() => StyleSheet.create({
    tabBar: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
      height: 56,
      borderRadius: 28,
      marginHorizontal: 40,
      marginBottom: 28,
      position: 'absolute' as const,
      paddingHorizontal: Spacing.xs,
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
      borderRadius: Radius.xl,
      width: 70,
      height: 44,
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
      screenOptions={{
        headerShown: false,
        tabBarStyle: hideTabBar
          ? [styles.tabBar, { display: 'none' }]
          : styles.tabBar,
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
                  tabIconStyle={styles.tabIcon}
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
