import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchUnreadFriendActivityCount } from '@/services/api/friends';
import { useTheme, Spacing, Radius } from '@/theme';

const TAB_CONFIG: {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { name: 'messages', icon: 'chatbubble-outline', label: '消息' },
  { name: 'contacts', icon: 'people-outline', label: '联系人' },
  { name: 'discover', icon: 'play-circle-outline', label: '动态' },
  { name: 'profile', icon: 'person-outline', label: '我的' },
];

interface TabIconProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  focused: boolean;
  showUnreadFriendActivityDot: boolean;
}

export default function TabLayout() {
  const { colors } = useTheme();
  const segments = useSegments();
  const hideTabBar = segments.length > 2;
  const [unreadFriendActivityCount, setUnreadFriendActivityCount] = useState(0);

  const refreshUnreadFriendActivityCount = useCallback(async () => {
    try {
      const count = await fetchUnreadFriendActivityCount();
      setUnreadFriendActivityCount(count);
    } catch {
      setUnreadFriendActivityCount(0);
    }
  }, []);

  useEffect(() => {
    refreshUnreadFriendActivityCount();
  }, [refreshUnreadFriendActivityCount, segments]);

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
      elevation: 0,
      paddingHorizontal: Spacing.xs,
      paddingBottom: 0,
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

  const TabIcon: React.FC<TabIconProps> = ({
    icon,
    label,
    focused,
    showUnreadFriendActivityDot,
  }) => {
    const color = focused ? colors.white : colors.textSecondary;

    return (
      <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
        {showUnreadFriendActivityDot ? <View style={styles.tabIconBadge} /> : null}
        <Ionicons name={icon} size={16} color={color} />
        <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  };

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
      {TAB_CONFIG.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon
                icon={tab.icon}
                label={tab.label}
                focused={focused}
                showUnreadFriendActivityDot={
                  tab.name === 'contacts' && unreadFriendActivityCount > 0
                }
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
