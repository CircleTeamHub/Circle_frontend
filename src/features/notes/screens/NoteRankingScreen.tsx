import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useCityPickStore } from '@/features/discover/store/use-city-pick-store';
import { useNoteRanking } from '@/features/notes/hooks/use-note-ranking';
import { NoteRankingRow } from '@/features/notes/components/NoteRankingRow';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { getNoteDetailHref } from '@/features/user/utils/routes';
import type { NoteSummary } from '@/features/notes/types';

const s = StyleSheet.create({
  filters: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  chip: {
    height: 32,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  chipText: { ...Typography.caption, fontWeight: '600' },
  subtitle: { ...Typography.small, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  list: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm },
  state: { alignItems: 'center', paddingTop: Spacing.xxl, paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  stateText: { ...Typography.bodyRegular, textAlign: 'center' },
  retry: { ...Typography.body, fontWeight: '600' },
});

const keyExtractor = (note: NoteSummary) => note.id;

/** 探索 → 大众点评：本月好评最多的笔记，按城市筛选，每月 1 号（上海时区）重新排。 */
export default function NoteRankingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // 默认看自己资料里的城市；没填就看全国。
  const homeCity = useAuthStore((state) => state.user?.city ?? null);
  const [city, setCity] = useState<string | null>(homeCity);
  const consumePickedCity = useCityPickStore((state) => state.consume);
  const { ranking, loading, error, reload } = useNoteRanking(city);
  const pull = usePullRefresh(reload);

  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedCity('ranking');
      if (picked) setCity(picked);
    }, [consumePickedCity]),
  );

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
      chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
      chipActive: { backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.primary },
      chipText: { color: colors.text },
      chipTextActive: { color: colors.white },
      secondary: { color: colors.textSecondary },
      link: { color: colors.primary },
      listBottom: { paddingBottom: insets.bottom + Spacing.xl },
    }),
    [colors, insets.bottom, insets.top],
  );

  const openCityPicker = useCallback(() => {
    router.push({
      pathname: '/(tabs)/explore/select-city',
      params: { target: 'ranking', ...(city ? { city } : {}) },
    });
  }, [city, router]);
  const openNote = useCallback(
    (note: NoteSummary) => router.push(getNoteDetailHref('explore', note.id, note.ownerId ?? '')),
    [router],
  );
  const renderItem = useCallback(
    ({ item, index }: { item: NoteSummary; index: number }) => (
      <NoteRankingRow rank={index + 1} note={item} onPress={openNote} />
    ),
    [openNote],
  );

  const month = ranking ? Number(ranking.month.slice(5, 7)) : null;
  const items = ranking?.items ?? [];

  return (
    <View style={d.container}>
      <NavHeader title={t('explore.ranking.title', { defaultValue: '大众点评' })} />
      <View style={s.filters}>
        <Pressable
          style={[s.chip, city === null ? d.chipActive : d.chip]}
          onPress={() => setCity(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: city === null }}
        >
          <Text style={[s.chipText, city === null ? d.chipTextActive : d.chipText]}>
            {t('explore.ranking.nationwide', { defaultValue: '全国' })}
          </Text>
        </Pressable>
        <Pressable
          style={[s.chip, city !== null ? d.chipActive : d.chip]}
          onPress={openCityPicker}
          accessibilityRole="button"
          accessibilityState={{ selected: city !== null }}
        >
          <Ionicons name="location-outline" size={14} color={city !== null ? colors.white : colors.text} />
          <Text style={[s.chipText, city !== null ? d.chipTextActive : d.chipText]}>
            {city ?? t('explore.ranking.chooseCity', { defaultValue: '选择城市' })}
          </Text>
          <Ionicons name="chevron-down" size={13} color={city !== null ? colors.white : colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={[s.subtitle, d.secondary]}>
        {month
          ? t('explore.ranking.subtitle', { defaultValue: '{{month}} 月好评榜 · 每月 1 号重新排', month })
          : t('explore.ranking.subtitleNoMonth', { defaultValue: '本月好评榜 · 每月 1 号重新排' })}
      </Text>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={[s.list, d.listBottom]}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        initialNumToRender={8}
        ListEmptyComponent={
          loading && !pull.refreshing ? (
            <View style={s.state} testID="note-ranking-loading">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={s.state}>
              <Text style={[s.stateText, d.secondary]}>{error}</Text>
              <Pressable onPress={reload} accessibilityRole="button" hitSlop={8}>
                <Text style={[s.retry, d.link]}>{t('common.retry', { defaultValue: '重试' })}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.state}>
              <Text style={[s.stateText, d.secondary]}>
                {city
                  ? t('explore.ranking.emptyCity', { defaultValue: '{{city}}这个月还没有上榜的笔记', city })
                  : t('explore.ranking.empty', { defaultValue: '这个月还没有上榜的笔记' })}
              </Text>
              <Text style={[s.stateText, d.secondary]}>
                {t('explore.ranking.emptyHint', {
                  defaultValue: '在笔记标题里选上城市，收到好评就会上榜。',
                })}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}
