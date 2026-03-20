import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
}

export default function TabLayout() {
  const { colors } = useTheme();

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
    },
    tabIconActive: {
      backgroundColor: colors.primary,
    },
    tabLabel: {
      fontSize: 9,
      fontWeight: '500' as const,
      letterSpacing: 0.3,
    },
  }), [colors]);

  const TabIcon: React.FC<TabIconProps> = ({ icon, label, focused }) => {
    const color = focused ? colors.white : colors.textSecondary;

    return (
      <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
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
        tabBarStyle: styles.tabBar,
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
              <TabIcon icon={tab.icon} label={tab.label} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
