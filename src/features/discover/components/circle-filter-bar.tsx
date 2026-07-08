import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { Circle } from '@/types';

interface CircleFilterBarProps {
  circles: Circle[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditOrder: () => void;
}

interface FilterItem {
  id: string | null;
  name: string;
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  list: {
    flex: 1,
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
  editButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    transform: [{ translateX: Spacing.xs }],
  },
});

export const CircleFilterBar: React.FC<CircleFilterBarProps> = ({
  circles,
  selectedId,
  onSelect,
  onEditOrder,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const items: FilterItem[] = useMemo(
    () => [
      { id: null, name: t('common.all') },
      ...circles.map((c) => ({ id: c.id, name: c.name })),
    ],
    [circles, t],
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
    <View style={s.container}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.list}
        contentContainerStyle={s.listContent}
      />
      <Pressable
        style={[
          s.editButton,
          {
            backgroundColor: colors.surface,
            borderColor: colors.surfaceBorder,
          },
        ]}
        onPress={onEditOrder}
        hitSlop={8}
      >
        <Ionicons
          name="reorder-three-outline"
          size={22}
          color={colors.textSecondary}
        />
      </Pressable>
    </View>
  );
};
