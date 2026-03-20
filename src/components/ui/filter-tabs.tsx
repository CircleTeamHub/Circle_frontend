import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme, Spacing, Radius, Typography } from '@/theme';

interface FilterTabsProps {
  tabs: string[];
  activeIndex: number;
  onTabPress: (index: number) => void;
}

export const FilterTabs: React.FC<FilterTabsProps> = ({
  tabs,
  activeIndex,
  onTabPress,
}) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          gap: Spacing.sm,
        },
        tab: {
          borderRadius: Radius.md,
          height: 32,
          paddingHorizontal: Spacing.md,
          justifyContent: 'center',
          alignItems: 'center',
        },
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
          onPress={() => onTabPress(index)}
          style={[styles.tab, active && styles.tabActive]}
        >
          <Text style={[styles.label, active && styles.labelActive]}>
            {tab}
          </Text>
        </Pressable>
      );
    },
    [activeIndex, onTabPress, styles],
  );

  return <View style={styles.row}>{tabs.map(renderTab)}</View>;
};
