import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';
import type { Circle } from '@/types';

const s = StyleSheet.create({
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  searchInput: {
    height: 40,
    borderRadius: Radius.xxl,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    ...Typography.bodyRegular,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  countText: {
    ...Typography.caption,
  },
  toggleAllText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
  },
  info: {
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: Spacing.md,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  confirmBtn: {
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    ...Typography.body,
    fontWeight: '600',
  },
});

export default function SelectFilterCirclesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const allCircles = useCirclesStore((st) => st.allCircles);
  const allCirclesLoading = useCirclesStore((st) => st.allCirclesLoading);
  const allCirclesError = useCirclesStore((st) => st.allCirclesError);
  const fetchAllCircles = useCirclesStore((st) => st.fetchAllCircles);

  const draftCircleIds = useDiscoverFilterStore((st) => st.draftCircleIds);
  const setDraftCircleIds = useDiscoverFilterStore((st) => st.setDraftCircleIds);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (allCircles.length === 0) {
      fetchAllCircles();
    }
  }, [allCircles.length, fetchAllCircles]);

  useFocusEffect(
    useCallback(() => {
      setSelected([...draftCircleIds]);
    }, [draftCircleIds]),
  );

  const filteredCircles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCircles;
    return allCircles.filter(
      (circle) =>
        circle.name.toLowerCase().includes(q) ||
        circle.description.toLowerCase().includes(q),
    );
  }, [allCircles, search]);

  const allFilteredSelected = useMemo(
    () =>
      filteredCircles.length > 0 &&
      filteredCircles.every((circle) => selected.includes(circle.id)),
    [filteredCircles, selected],
  );

  const toggleCircle = useCallback((id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredCircles.map((c) => c.id));
      setSelected((prev) => prev.filter((id) => !filteredIds.has(id)));
    } else {
      setSelected((prev) => {
        const merged = new Set(prev);
        for (const c of filteredCircles) merged.add(c.id);
        return Array.from(merged);
      });
    }
  }, [allFilteredSelected, filteredCircles]);

  const handleConfirm = useCallback(() => {
    setDraftCircleIds(selected);
    router.back();
  }, [router, selected, setDraftCircleIds]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      searchInput: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        color: colors.text,
      },
      countText: { color: colors.textSecondary },
      toggleAllText: { color: colors.primary },
      cover: { backgroundColor: colors.surfaceBorder },
      name: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      desc: { color: colors.textSecondary, ...Typography.caption },
      emptyText: { color: colors.textSecondary, ...Typography.body },
      retryButton: {
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: colors.primary,
      },
      retryText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const renderItem = useCallback(
    ({ item }: { item: Circle }) => {
      const isSelected = selected.includes(item.id);
      return (
        <View>
          <Pressable
            style={s.row}
            onPress={() => toggleCircle(item.id)}
          >
            <Image
              source={{ uri: item.avatarUrl ?? undefined }}
              style={[s.cover, d.cover]}
            />
            <View style={s.info}>
              <Text style={d.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.description ? (
                <Text style={d.desc} numberOfLines={1}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isSelected ? colors.primary : colors.textSecondary}
            />
          </Pressable>
          <Divider />
        </View>
      );
    },
    [selected, toggleCircle, colors, d],
  );

  const keyExtractor = useCallback((item: Circle) => item.id, []);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('discover.filter.selectCirclesTitle')} />

      <View style={s.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('common.search')}
          placeholderTextColor={colors.textSecondary}
          style={[s.searchInput, d.searchInput]}
        />
      </View>

      <View style={s.topBar}>
        <Text style={[s.countText, d.countText]}>
          {t('discover.filter.savedCirclesCount', { count: selected.length })}
        </Text>
        {filteredCircles.length > 0 ? (
          <Pressable onPress={toggleSelectAll} hitSlop={8}>
            <Text style={[s.toggleAllText, d.toggleAllText]}>
              {allFilteredSelected
                ? t('discover.filter.unselectAll')
                : t('discover.filter.selectAll')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {allCirclesLoading && allCircles.length === 0 ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : allCirclesError && allCircles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{allCirclesError}</Text>
          <Pressable style={d.retryButton} onPress={fetchAllCircles}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredCircles}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>{t('discover.filter.noCircles')}</Text>
            </View>
          }
        />
      )}

      <View style={[s.footer, { paddingBottom: insets.bottom || Spacing.md }]}>
        <Pressable
          style={[s.confirmBtn, { backgroundColor: colors.primary }]}
          onPress={handleConfirm}
        >
          <Text style={[s.confirmText, { color: colors.white }]}>
            {t('common.confirm')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
