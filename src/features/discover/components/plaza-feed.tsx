import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { useShallow } from 'zustand/react/shallow';
import { Spacing, Typography, useTheme } from '@/theme';
import { fetchMembershipProgramStatus } from '@/services/api/membership';
import { useAuthStore } from '@/stores/authStore';
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
    flex: 1,
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
  const router = useRouter();
  const { colors } = useTheme();
  const vipLevel = useAuthStore((state) => state.user?.vipLevel ?? 0);
  const [programEnabled, setProgramEnabled] = useState<boolean | null>(null);
  const [isOrderSheetVisible, setIsOrderSheetVisible] = useState(false);
  const {
    plazaPosts,
    plazaLoading,
    plazaRefreshing,
    plazaMembershipRequired,
    plazaHasMore,
    selectedCircleId,
    selectedCity,
    fetchPlazaPosts,
    setPlazaFilter,
  } = useDiscoverStore(
    useShallow((s) => ({
      plazaPosts: s.plazaPosts,
      plazaLoading: s.plazaLoading,
      plazaRefreshing: s.plazaRefreshing,
      plazaMembershipRequired: s.plazaMembershipRequired,
      plazaHasMore: s.plazaHasMore,
      selectedCircleId: s.selectedCircleId,
      selectedCity: s.selectedCity,
      fetchPlazaPosts: s.fetchPlazaPosts,
      setPlazaFilter: s.setPlazaFilter,
    })),
  );

  const {
    joinedCircles,
    createdCircles,
    myCirclesError,
    fetchMyCircles,
  } = useCirclesStore(
    useShallow((s) => ({
      joinedCircles: s.joinedCircles,
      createdCircles: s.createdCircles,
      myCirclesError: s.myCirclesError,
      fetchMyCircles: s.fetchMyCircles,
    })),
  );
  const filterCircleIds = useDiscoverFilterStore((st) => st.appliedCircleIds);
  const filterCities = useDiscoverFilterStore((st) => st.appliedCities);
  const shortcutOrderIds = useCircleShortcutOrderStore((st) => st.orderIds);
  const setShortcutOrderIds = useCircleShortcutOrderStore((st) => st.setOrderIds);
  const resetShortcutOrder = useCircleShortcutOrderStore((st) => st.resetOrder);
  const membershipBlocked =
    plazaMembershipRequired || (programEnabled === true && vipLevel <= 0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // 不在每次聚焦时把 programEnabled 重置为 null——那会让整屏闪一下 spinner、丢滚动位置。
      // 首次加载本就是 null(显示 spinner);重新聚焦时保留上次已知值、原地刷新,避免闪烁。
      void fetchMembershipProgramStatus()
        .then((status) => {
          if (active) setProgramEnabled(status.enabled);
        })
        .catch(() => {
          // rollout 状态查询瞬时失败（超时 / 5xx）时 fail-open：不要预设「已开放」而把
          // 非会员挡在升级墙外、藏掉已缓存的帖子、也不再拉取。交给 feed 用后端权威的
          // PLAZA_MEMBERSHIP_REQUIRED 响应来决定是否拦截。
          if (active) setProgramEnabled(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

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

  // 圈子快捷入口随页面获得焦点刷新（#107）：在别处加入/退出圈子后回到广场，
  // 不再要等组件重挂载才更新。fetchMyCircles 自带单飞（#106），焦点抖动不会
  // 放大成并发请求风暴。
  useFocusEffect(
    useCallback(() => {
      if (programEnabled === null || membershipBlocked) return;
      void fetchMyCircles();
    }, [fetchMyCircles, membershipBlocked, programEnabled]),
  );

  useEffect(() => {
    if (programEnabled === null || membershipBlocked) return;
    fetchPlazaPosts(true);
  }, [
    fetchPlazaPosts,
    filterCircleIds,
    filterCities,
    selectedCircleId,
    selectedCity,
    membershipBlocked,
    programEnabled,
  ]);

  // 同账号升级(如客服升级)后 vipLevel 由非会员变会员:上次留下的 plazaMembershipRequired
  // 会让 membershipBlocked 一直为真、上面的拉取 effect 不再发请求去清它。这里在「实际发生
  // 升级」的那一次显式重拉(fetchPlazaPosts 开头把门置 false),让已升级用户立刻能看 feed。
  //
  // 关键:必须判「vipLevel 的升级跃迁」而不是只判 `vipLevel>0 && 有门`——否则当客户端
  // vipLevel 陈旧为正、但会员已到期/降级、服务端权威返回 PLAZA_MEMBERSHIP_REQUIRED 时,
  // 重拉→门清→再被拒→门起→再重拉,会无限循环打服务端。
  const prevVipLevelRef = useRef(vipLevel);
  useEffect(() => {
    const prev = prevVipLevelRef.current;
    prevVipLevelRef.current = vipLevel;
    if (prev <= 0 && vipLevel > 0 && plazaMembershipRequired) {
      fetchPlazaPosts(true);
    }
  }, [vipLevel, plazaMembershipRequired, fetchPlazaPosts]);

  // rollout 从「开放/未知」翻成「关闭」而上次还留着会员门:membershipBlocked 会因陈旧的
  // plazaMembershipRequired 恒为真(programEnabled===false 让第二个从句失效,但 OR 的第一
  // 从句仍真),上面两个拉取 effect 都因 membershipBlocked 短路、免费开放对该用户永不生效,
  // 直到登出/重启。这里在「enabled/unknown → disabled」这一次跃迁显式重拉一次清掉门。
  // 判跃迁(prev !== false)而非只判「disabled 且有门」:否则后端若仍权威返回门,会重拉→
  // 门清→再被拒→门起→再重拉地空转打服务端(与上面的 vipLevel 跃迁守卫同理)。
  const prevProgramEnabledRef = useRef(programEnabled);
  useEffect(() => {
    const prev = prevProgramEnabledRef.current;
    prevProgramEnabledRef.current = programEnabled;
    if (prev !== false && programEnabled === false && plazaMembershipRequired) {
      fetchPlazaPosts(true);
    }
  }, [programEnabled, plazaMembershipRequired, fetchPlazaPosts]);

  const handleRefresh = useCallback(() => {
    fetchPlazaPosts(true);
  }, [fetchPlazaPosts]);

  const handleEndReached = useCallback(() => {
    if (
      plazaPosts.length > 0 &&
      !plazaLoading &&
      !plazaRefreshing &&
      plazaHasMore
    ) {
      fetchPlazaPosts(false);
    }
  }, [
    plazaPosts.length,
    plazaLoading,
    plazaRefreshing,
    plazaHasMore,
    fetchPlazaPosts,
  ]);

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
            <Pressable onPress={() => fetchMyCircles()}>
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

  if (programEnabled === null) {
    return (
      <View style={s.emptyContainer}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (membershipBlocked) {
    return (
      <View style={s.emptyContainer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/profile/member-center' as never)}
        >
          <Text style={{ color: colors.primary, ...Typography.body }}>
            {t('serverErrors.PLAZA_MEMBERSHIP_REQUIRED', {
              defaultValue: '升级会员查看圈子动态',
            })}
          </Text>
        </Pressable>
      </View>
    );
  }

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
