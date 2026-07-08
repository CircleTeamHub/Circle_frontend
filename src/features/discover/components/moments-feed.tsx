import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Spacing, Typography, useTheme } from '@/theme';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';
import { toggleMomentLike, fetchNewMomentsCount } from '@/services/api/moments';
import { MomentCard } from './moment-card';
import type { MomentPost } from '@/types';

const s = StyleSheet.create({
  listContent: {
    paddingBottom: 100,
    gap: Spacing.lg,
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
  newPostsBanner: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: 20,
  },
  bannerText: {
    ...Typography.caption,
    fontWeight: '600',
  },
});

export const MomentsFeed: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const {
    moments,
    loading,
    hasMore,
    lastRefreshTime,
    fetchMoments,
    toggleLike: storeToggleLike,
  } = useMomentsStore(
    useShallow((s) => ({
      moments: s.moments,
      loading: s.loading,
      hasMore: s.hasMore,
      lastRefreshTime: s.lastRefreshTime,
      fetchMoments: s.fetchMoments,
      toggleLike: s.toggleLike,
    })),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const lastFocusFetchRef = useRef(0);

  // Auto refresh on focus (silent, no spinner), throttled to 30s so rapid
  // re-focus doesn't refetch the whole feed.
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFocusFetchRef.current < 30_000) return;
      lastFocusFetchRef.current = now;
      fetchMoments(true);
    }, [fetchMoments]),
  );

  // Poll for new posts every 30s, but only while app is foregrounded.
  // 后台时清掉定时器避免 JS bridge 被叫醒；回到前台立即补一次拉取再继续 polling。
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!lastRefreshTime) return;

    const pollOnce = async () => {
      try {
        const count = await fetchNewMomentsCount(lastRefreshTime);
        setNewCount(count);
      } catch (error) {
        if (__DEV__) {
          console.warn('[MomentsFeed] fetchNewMomentsCount failed', error);
        }
      }
    };

    const startInterval = () => {
      if (intervalRef.current != null) return;
      intervalRef.current = setInterval(pollOnce, 30_000);
    };

    const stopInterval = () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    if (AppState.currentState === 'active') startInterval();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        pollOnce();
        startInterval();
      } else {
        stopInterval();
      }
    });

    return () => {
      sub.remove();
      stopInterval();
    };
  }, [lastRefreshTime]);

  // Manual pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setNewCount(0);
    await fetchMoments(true);
    setRefreshing(false);
  }, [fetchMoments]);

  const handleEndReached = useCallback(() => {
    if (!loading && hasMore) {
      fetchMoments(false);
    }
  }, [loading, hasMore, fetchMoments]);

  const handleLike = useCallback(
    async (postId: string) => {
      const post = moments.find((m) => m.id === postId);
      if (!post) return;

      const optimisticLiked = !post.isLikedByMe;
      const optimisticCount = post.likeCount + (optimisticLiked ? 1 : -1);
      storeToggleLike(postId, optimisticLiked, optimisticCount);

      try {
        const result = await toggleMomentLike(postId);
        storeToggleLike(postId, result.liked, result.likeCount);
      } catch (error) {
        storeToggleLike(postId, post.isLikedByMe, post.likeCount);
        if (__DEV__) {
          console.warn('[MomentsFeed] toggleMomentLike failed, rolled back', error);
        }
      }
    },
    [moments, storeToggleLike],
  );

  const handlePress = useCallback(
    (postId: string) => {
      router.push({
        pathname: '/(tabs)/discover/moment/[id]',
        params: { id: postId },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: MomentPost }) => (
      <MomentCard
        post={item}
        onLike={handleLike}
        onPress={handlePress}
      />
    ),
    [handleLike, handlePress],
  );

  const keyExtractor = useCallback((item: MomentPost) => item.id, []);

  const ListHeader =
    newCount > 0 ? (
      <Pressable
        style={[s.newPostsBanner, { backgroundColor: colors.primary }]}
        onPress={handleRefresh}
      >
        <Text style={[s.bannerText, { color: colors.white }]}>
          {t('discover.newPosts', { count: newCount })}
        </Text>
      </Pressable>
    ) : null;

  const ListEmpty = !loading ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        {t('discover.noMoments')}
      </Text>
      <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
        {t('discover.addFriendHint')}
      </Text>
    </View>
  ) : null;

  const ListFooter =
    loading && moments.length > 0 ? (
      <View style={s.footerLoader}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : null;

  return (
    <FlatList
      data={moments}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={ListHeader}
      ListEmptyComponent={ListEmpty}
      ListFooterComponent={ListFooter}
      contentContainerStyle={s.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
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
