import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
  const { colors } = useTheme();
  const router = useRouter();
  const {
    moments,
    loading,
    hasMore,
    lastRefreshTime,
    fetchMoments,
    toggleLike: storeToggleLike,
  } = useMomentsStore();

  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState(0);

  // Auto refresh on focus (silent, no spinner)
  useFocusEffect(
    useCallback(() => {
      fetchMoments(true);
    }, [fetchMoments]),
  );

  // Poll for new posts every 30s
  useEffect(() => {
    if (!lastRefreshTime) return;
    const timer = setInterval(async () => {
      try {
        const count = await fetchNewMomentsCount(lastRefreshTime);
        setNewCount(count);
      } catch {
        // ignore
      }
    }, 30000);
    return () => clearInterval(timer);
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
      } catch {
        storeToggleLike(postId, post.isLikedByMe, post.likeCount);
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
        style={[s.newPostsBanner, { backgroundColor: colors.primaryLight }]}
        onPress={handleRefresh}
      >
        <Text style={[s.bannerText, { color: colors.primary }]}>
          有{newCount}条新动态，点击查看
        </Text>
      </Pressable>
    ) : null;

  const ListEmpty = !loading ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        暂无朋友圈动态
      </Text>
      <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
        添加好友后即可看到朋友的动态
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
