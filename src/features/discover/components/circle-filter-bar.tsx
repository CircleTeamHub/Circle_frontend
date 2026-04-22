import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { Circle } from '@/types';

interface CircleFilterBarProps {
  circles: Circle[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface FilterItem {
  id: string | null;
  name: string;
}

const s = StyleSheet.create({
  list: {
    marginBottom: Spacing.sm,
  },
  listContent: {
    gap: Spacing.sm,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  pillText: {
    ...Typography.caption,
    fontWeight: '600',
  },
});

export const CircleFilterBar: React.FC<CircleFilterBarProps> = ({
  circles,
  selectedId,
  onSelect,
}) => {
  const { colors } = useTheme();

  const items: FilterItem[] = useMemo(
    () => [
      { id: null, name: '全部' },
      ...circles.map((c) => ({ id: c.id, name: c.name })),
    ],
    [circles],
  );

  const renderItem = useCallback(
    ({ item }: { item: FilterItem }) => {
      const isActive = item.id === selectedId;
      return (
        <Pressable
          onPress={() => onSelect(item.id)}
          style={[
            s.pill,
            {
              backgroundColor: isActive ? colors.primary : colors.surface,
              borderColor: isActive ? colors.primary : colors.surfaceBorder,
            },
          ]}
        >
          <Text
            style={[
              s.pillText,
              { color: isActive ? colors.white : colors.textSecondary },
            ]}
          >
            {item.name}
          </Text>
        </Pressable>
      );
    },
    [selectedId, colors, onSelect],
  );

  const keyExtractor = useCallback((item: FilterItem) => item.id ?? 'all', []);

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.list}
      contentContainerStyle={s.listContent}
    />
  );
};
