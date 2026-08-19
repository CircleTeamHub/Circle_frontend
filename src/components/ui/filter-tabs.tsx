import { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTheme, Spacing, Radius, Typography } from '@/theme';

interface FilterTabsProps {
  tabs: string[];
  activeIndex: number;
  onTabPress: (index: number) => void;
  scrollable?: boolean;
  testIDForIndex?: (index: number) => string;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  scrollContent: {
    paddingRight: Spacing.lg,
  },
  tab: {
    borderRadius: Radius.md,
    height: 32,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export const FilterTabs: React.FC<FilterTabsProps> = ({
  tabs,
  activeIndex,
  onTabPress,
  scrollable = false,
  testIDForIndex,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      tabActive: {
        backgroundColor: colors.primary,
      },
      label: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      labelActive: {
        color: colors.white,
      },
    }),
    [colors],
  );

  const renderTab = useCallback(
    (tab: string, index: number) => {
      const active = index === activeIndex;
      return (
        <Pressable
          key={tab}
          testID={testIDForIndex?.(index)}
          onPress={() => onTabPress(index)}
          style={[s.tab, active && d.tabActive]}
          accessibilityRole="tab"
          accessibilityLabel={tab}
          accessibilityState={{ selected: active }}
        >
          <Text style={[d.label, active && d.labelActive]} numberOfLines={1}>
            {tab}
          </Text>
        </Pressable>
      );
    },
    [activeIndex, onTabPress, d, testIDForIndex],
  );

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[s.row, s.scrollContent]}
        accessibilityRole="tablist"
      >
        {tabs.map(renderTab)}
      </ScrollView>
    );
  }

  return (
    <View style={s.row} accessibilityRole="tablist">
      {tabs.map(renderTab)}
    </View>
  );
};
