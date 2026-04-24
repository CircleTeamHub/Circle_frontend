import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
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
}

export default function TabLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const segments = useSegments();
  const hideTabBar = segments.length > 2;
  const messagesUnread = useTabBadgeStore((state) => state.messagesUnread);
  const contactsUnread = useTabBadgeStore((state) => state.contactsUnread);
  const discoverUnread = useTabBadgeStore((state) => state.discoverUnread);
  const profileUnread = useTabBadgeStore((state) => state.profileUnread);

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

  const TabIcon: React.FC<TabIconProps> = ({
    icon,
    label,
    focused,
    showBadgeDot,
  }) => {
    const color = focused ? colors.white : colors.textSecondary;

    return (
      <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
        {showBadgeDot ? <View style={styles.tabIconBadge} /> : null}
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
      {TAB_KEYS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarIcon: ({ focused }) => (
                <TabIcon
                  icon={tab.icon}
                  label={t(tab.key)}
                  focused={focused}
                  showBadgeDot={
                    (tab.name === 'messages' && messagesUnread > 0) ||
                    (tab.name === 'contacts' && contactsUnread > 0) ||
                    (tab.name === 'discover' && discoverUnread > 0) ||
                    (tab.name === 'profile' && profileUnread > 0)
                  }
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
