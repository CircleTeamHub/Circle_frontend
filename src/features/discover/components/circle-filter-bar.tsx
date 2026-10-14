import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, Typography, useTheme } from '@/theme';
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

// Mirrors the notes group tabs (NotesScreen tabsRow): plain text labels with
// an underline on the active one, so more circle names fit on one row.
const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: Spacing.sm,
  },
  list: {
    flex: 1,
    minWidth: 0,
  },
  listContent: {
    gap: Spacing.md,
    paddingHorizontal: 2,
    alignItems: 'flex-end',
  },
  tab: {
    paddingTop: Spacing.xs,
    paddingBottom: 6,
    alignItems: 'center',
  },
  tabText: {
    ...Typography.bodyRegular,
    fontWeight: '500',
  },
  tabLine: {
    height: 2,
    borderRadius: 1,
    width: '100%',
    marginTop: Spacing.xs,
  },
  editButton: {
    width: 40,
    paddingBottom: 6,
    alignItems: 'flex-end',
    justifyContent: 'center',
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
        <Pressable onPress={() => onSelect(item.id)} style={s.tab}>
          <Text
            style={[s.tabText, { color: colors.text }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {isActive ? (
            <View style={[s.tabLine, { backgroundColor: colors.primary }]} />
          ) : null}
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
      <Pressable style={s.editButton} onPress={onEditOrder} hitSlop={8}>
        <Ionicons
          name="ellipsis-horizontal"
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>
    </View>
  );
};
