import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useCircleShortcutOrderStore } from '@/features/discover/store/use-circle-shortcut-order-store';
import { orderCircleShortcuts } from '@/features/discover/utils/circle-shortcut-order';
import { PlazaPostCard } from './plaza-post-card';
import { CircleFilterBar } from './circle-filter-bar';
import { CircleShortcutOrderSheet } from './circle-shortcut-order-sheet';
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
  const [isOrderSheetVisible, setIsOrderSheetVisible] = useState(false);
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
  const shortcutOrderIds = useCircleShortcutOrderStore((st) => st.orderIds);
  const setShortcutOrderIds = useCircleShortcutOrderStore((st) => st.setOrderIds);
  const resetShortcutOrder = useCircleShortcutOrderStore((st) => st.resetOrder);

  const myPlazaCircles = useMemo(() => {
    const byId = new Map(joinedCircles.map((circle) => [circle.id, circle]));
    for (const circle of createdCircles) {
      byId.set(circle.id, circle);
    }
    return [...byId.values()];
  }, [createdCircles, joinedCircles]);

  const visibleCircles = useMemo(
    () => orderCircleShortcuts(myPlazaCircles, shortcutOrderIds),
    [myPlazaCircles, shortcutOrderIds],
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
    if (plazaPosts.length > 0 && !plazaLoading && plazaHasMore) {
      fetchPlazaPosts(false);
    }
  }, [plazaPosts.length, plazaLoading, plazaHasMore, fetchPlazaPosts]);

  const handleCircleSelect = useCallback(
    (id: string | null) => {
      setPlazaFilter(id, null);
    },
    [setPlazaFilter],
  );

  const handleOpenOrderSheet = useCallback(() => {
    setIsOrderSheetVisible(true);
  }, []);

  const handleCloseOrderSheet = useCallback(() => {
    setIsOrderSheetVisible(false);
  }, []);

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
            onEditOrder={handleOpenOrderSheet}
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
        {t('discover.noActiveActivity', {
          defaultValue: '暂无进行中的动态',
        })}
      </Text>
      <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
        {t('discover.endedActivityHiddenHint', {
          defaultValue: '已结束或过期的动态不会展示在广场',
        })}
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
    <>
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
      <CircleShortcutOrderSheet
        visible={isOrderSheetVisible}
        circles={myPlazaCircles}
        orderIds={shortcutOrderIds}
        onSave={setShortcutOrderIds}
        onReset={resetShortcutOrder}
        onClose={handleCloseOrderSheet}
      />
    </>
  );
};
