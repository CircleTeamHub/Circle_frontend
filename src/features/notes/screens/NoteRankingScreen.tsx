import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useCityPickStore } from '@/features/discover/store/use-city-pick-store';
import { useNoteRanking } from '@/features/notes/hooks/use-note-ranking';
import { NoteRankingHero } from '@/features/notes/components/NoteRankingHero';
import { NoteRankingRow, RANK_COLUMN_WIDTH, RANK_GAP } from '@/features/notes/components/NoteRankingRow';
import { NoteRankingStatus } from '@/features/notes/components/NoteRankingStatus';
import type { NoteCardSection } from '@/features/chat/components/bubbles/note-card-body';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { getNoteDetailHref } from '@/features/user/utils/routes';
import type { NoteRankingItem } from '@/features/notes/types';

/** 宽屏（平板、桌面网页）上榜单不铺满：卡片再宽四宫格就太大了。 */
const MAX_CONTENT_WIDTH = 600;
const PAGE_GUTTER = Spacing.md;

const s = StyleSheet.create({
  list: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: PAGE_GUTTER,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
});

const keyExtractor = (note: NoteRankingItem) => note.id;

/** 探索 → 大众点评：本月好评最多的笔记，全国或按城市看，每月 1 号（上海时区）重新排。 */
export default function NoteRankingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  // 默认看自己资料里的城市；没填就看全国。切到全国后城市那一段仍记着上次的城市，点一下就回去。
  const homeCity = useAuthStore((state) => state.user?.city ?? null);
  const [city, setCity] = useState<string | null>(homeCity);
  const [lastCity, setLastCity] = useState<string | null>(homeCity);
  const consumePickedCity = useCityPickStore((state) => state.consume);
  const { ranking, loading, error, reload } = useNoteRanking(city);
  const pull = usePullRefresh(reload);

  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedCity('ranking');
      if (!picked) return;
      setCity(picked);
      setLastCity(picked);
    }, [consumePickedCity]),
  );

  const cardWidth =
    Math.min(windowWidth, MAX_CONTENT_WIDTH) - PAGE_GUTTER * 2 - RANK_COLUMN_WIDTH - RANK_GAP;
  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
      listBottom: { paddingBottom: insets.bottom + Spacing.xl },
    }),
    [colors.background, insets.bottom, insets.top],
  );

  const showNationwide = useCallback(() => setCity(null), []);
  const openCityPicker = useCallback(() => {
    router.push({
      pathname: '/(tabs)/explore/select-city',
      params: { target: 'ranking', ...(city ? { city } : {}) },
    });
  }, [city, router]);
  // 已在看城市榜：再点就是换城市；在全国榜：有上次的城市就直接切回去，没有才去选。
  const pressCity = useCallback(() => {
    if (city === null && lastCity) setCity(lastCity);
    else openCityPicker();
  }, [city, lastCity, openCityPicker]);
  const openNote = useCallback(
    (note: NoteRankingItem, section?: NoteCardSection) =>
      router.push(getNoteDetailHref('explore', note.id, note.ownerId ?? '', section ?? '')),
    [router],
  );
  const renderItem = useCallback(
    ({ item, index }: { item: NoteRankingItem; index: number }) => (
      <NoteRankingRow rank={index + 1} note={item} cardWidth={cardWidth} onOpen={openNote} />
    ),
    [cardWidth, openNote],
  );

  const month = ranking ? Number(ranking.month.slice(5, 7)) : null;
  const header = (
    <NoteRankingHero
      month={month}
      city={city}
      cityLabel={city ?? lastCity}
      onNationwide={showNationwide}
      onCity={pressCity}
    />
  );
  const status =
    loading && !pull.refreshing ? (
      <NoteRankingStatus kind="loading" />
    ) : error ? (
      <NoteRankingStatus kind="error" message={error} onRetry={reload} />
    ) : (
      <NoteRankingStatus kind="empty" city={city} onNationwide={showNationwide} />
    );

  return (
    <View style={d.container}>
      <NavHeader title={t('explore.ranking.title', { defaultValue: '大众点评' })} />
      <FlatList
        data={ranking?.items ?? []}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={status}
        contentContainerStyle={[s.list, d.listBottom]}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        initialNumToRender={6}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
