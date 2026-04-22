import { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Spacing, Typography, useTheme } from '@/theme';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
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

  const { allCircles, allCirclesError, fetchAllCircles } = useCirclesStore();

  useEffect(() => {
    fetchAllCircles();
  }, [fetchAllCircles]);

  useEffect(() => {
    fetchPlazaPosts(true);
  }, [fetchPlazaPosts, selectedCircleId, selectedCity]);

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
    allCircles.length > 0 || allCirclesError ? (
      <View style={s.headerSection}>
        {allCircles.length > 0 ? (
          <CircleFilterBar
            circles={allCircles}
            selectedId={selectedCircleId}
            onSelect={handleCircleSelect}
          />
        ) : null}
        {allCirclesError ? (
          <View
            style={[
              s.filterErrorBanner,
              { backgroundColor: colors.surface },
            ]}
          >
            <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
              {allCirclesError}
            </Text>
            <Pressable onPress={fetchAllCircles}>
              <Text style={{ color: colors.primary, ...Typography.caption }}>
                重试
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    ) : null;

  const ListEmpty = !plazaLoading ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        暂无动态
      </Text>
      <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
        加入圈子后即可看到广场动态
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
