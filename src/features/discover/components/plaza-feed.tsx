import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useDiscoverFilterStore } from '@/features/discover/store/use-discover-filter-store';
import { applyCircleFilter } from '@/features/discover/utils/circle-filter';
import { PlazaPostCard } from './plaza-post-card';
import { CircleFilterBar } from './circle-filter-bar';
import type { CirclePlazaPost } from '@/types';

const s = StyleSheet.create({
  listContent: {
    paddingBottom: 100,
    gap: Spacing.md,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: Spacing.md,
  },
  footerLoader: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  headerSection: {
    gap: Spacing.sm,
  },
  filterErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 16,
  },
});

export const PlazaFeed: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const {
    plazaPosts,
    plazaLoading,
    plazaRefreshing,
    plazaHasMore,
    selectedCircleId,
    selectedCity,
    fetchPlazaPosts,
    setPlazaFilter,
  } = useDiscoverStore();

  const {
    joinedCircles,
    createdCircles,
    myCirclesError,
    fetchMyCircles,
  } = useCirclesStore();
  const filterCircleIds = useDiscoverFilterStore((st) => st.appliedCircleIds);
  const filterCities = useDiscoverFilterStore((st) => st.appliedCities);

  const myPlazaCircles = useMemo(() => {
    const byId = new Map(joinedCircles.map((circle) => [circle.id, circle]));
    for (const circle of createdCircles) {
      byId.set(circle.id, circle);
    }
    return [...byId.values()];
  }, [createdCircles, joinedCircles]);

  const visibleCircles = useMemo(
    () =>
      applyCircleFilter(myPlazaCircles, {
        circleIds: filterCircleIds,
        cities: filterCities,
      }),
    [myPlazaCircles, filterCircleIds, filterCities],
  );

  useEffect(() => {
    fetchMyCircles();
  }, [fetchMyCircles]);

  useEffect(() => {
    fetchPlazaPosts(true);
  }, [
    fetchPlazaPosts,
    filterCircleIds,
    filterCities,
    selectedCircleId,
    selectedCity,
  ]);

  const handleRefresh = useCallback(() => {
    fetchPlazaPosts(true);
  }, [fetchPlazaPosts]);

  const handleEndReached = useCallback(() => {
    if (!plazaLoading && plazaHasMore) {
      fetchPlazaPosts(false);
    }
  }, [plazaLoading, plazaHasMore, fetchPlazaPosts]);

  const handleCircleSelect = useCallback(
    (id: string | null) => {
      setPlazaFilter(id, null);
    },
    [setPlazaFilter],
  );

  const renderItem = useCallback(
    ({ item }: { item: CirclePlazaPost }) => <PlazaPostCard post={item} />,
    [],
  );

  const keyExtractor = useCallback((item: CirclePlazaPost) => item.id, []);

  const ListHeader =
    visibleCircles.length > 0 || myCirclesError ? (
      <View style={s.headerSection}>
        {visibleCircles.length > 0 ? (
          <CircleFilterBar
            circles={visibleCircles}
            selectedId={selectedCircleId}
            onSelect={handleCircleSelect}
          />
        ) : null}
        {myCirclesError ? (
          <View
            style={[
              s.filterErrorBanner,
              { backgroundColor: colors.surface },
            ]}
          >
            <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
              {myCirclesError}
            </Text>
            <Pressable onPress={fetchMyCircles}>
              <Text style={{ color: colors.primary, ...Typography.caption }}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    ) : null;

  const ListEmpty = !plazaLoading ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        {t('discover.noActivity')}
      </Text>
      <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
        {t('discover.joinCircleHint')}
      </Text>
    </View>
  ) : null;

  const ListFooter =
    plazaLoading && plazaPosts.length > 0 ? (
      <View style={s.footerLoader}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : null;

  return (
    <FlatList
      data={plazaPosts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={ListHeader}
      ListEmptyComponent={ListEmpty}
      ListFooterComponent={ListFooter}
      contentContainerStyle={s.listContent}
      refreshControl={
        <RefreshControl
          refreshing={plazaRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.3}
      showsVerticalScrollIndicator={false}
    />
  );
};
