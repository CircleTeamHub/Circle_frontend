import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useMomentsFeedSignalStore } from '@/features/discover/store/use-moments-feed-signal-store';
import {
  addMomentComment,
  toggleMomentLike,
  fetchNewMomentsCount,
} from '@/services/api/moments';
import { getApiErrorMessage } from '@/services/api/errors';
import { MomentCard } from './moment-card';
import { MomentCommentInput } from './moment-comment-input';
import { MomentMentionNotice } from './moment-mention-notice';
import type { MomentPost } from '@/types';

const s = StyleSheet.create({
  // MomentCommentInput 是 absolute 全铺浮层，需要一个定位上下文来托管。
  feedContainer: {
    flex: 1,
  },
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
    addComment: storeAddComment,
  } = useMomentsStore(
    useShallow((s) => ({
      moments: s.moments,
      loading: s.loading,
      hasMore: s.hasMore,
      lastRefreshTime: s.lastRefreshTime,
      fetchMoments: s.fetchMoments,
      toggleLike: s.toggleLike,
      addComment: s.addComment,
    })),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [mentionNotice, setMentionNotice] = useState<string | null>(null);
  const dismissMentionNotice = useCallback(() => setMentionNotice(null), []);
  // 就地评论/回复目标（微信朋友圈式），设置后弹出输入浮层，无需进详情页。
  const [commentTarget, setCommentTarget] = useState<{
    momentId: string;
    replyTo: { id: string; nickname: string } | null;
  } | null>(null);
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

  // 新帖检测改为广播驱动（#89）：后端在好友发/删朋友圈时推 moments.feed.updated，
  // realtime client bump 信号，这里收到后查一次新帖数 —— 不再 30s 轮询。
  const checkNewMoments = useCallback(async () => {
    if (!lastRefreshTime) return;
    try {
      const count = await fetchNewMomentsCount(lastRefreshTime);
      setNewCount(count);
    } catch (error) {
      if (__DEV__) {
        console.warn('[MomentsFeed] fetchNewMomentsCount failed', error);
      }
    }
  }, [lastRefreshTime]);

  const feedSignalVersion = useMomentsFeedSignalStore((s) => s.version);
  const handledSignalRef = useRef(0);
  useEffect(() => {
    if (feedSignalVersion === handledSignalRef.current) return;
    // 尾沿去抖：一批好友接连发帖会连续 bump，800ms 内的多次信号合并成一次查询
    //（每次 bump 触发 effect 重跑，cleanup 把上一个 timer 掐掉）。
    const timer = setTimeout(() => {
      handledSignalRef.current = feedSignalVersion;
      void checkNewMoments();
    }, 800);
    return () => clearTimeout(timer);
  }, [feedSignalVersion, checkNewMoments]);

  // 回到前台补查一次，兜住后台/断连期间漏掉的广播（WS 后台不保活）。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkNewMoments();
    });
    return () => sub.remove();
  }, [checkNewMoments]);

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

  const handleComment = useCallback((postId: string) => {
    setCommentTarget({ momentId: postId, replyTo: null });
  }, []);

  const handleReplyComment = useCallback(
    (postId: string, replyTo: { id: string; nickname: string }) => {
      setCommentTarget({ momentId: postId, replyTo });
    },
    [],
  );

  const handleSubmitComment = useCallback(
    async (
      content: string,
      replyToId?: string,
      images?: string[],
      mentionedUserIds?: string[],
    ) => {
      const target = commentTarget;
      if (!target) return;
      try {
        const comment = await addMomentComment(target.momentId, {
          content,
          replyToId,
          images,
          mentionedUserIds,
        });
        storeAddComment(target.momentId, comment);
        setCommentTarget(null);
        if (comment.ignoredMentionCount > 0) {
          setMentionNotice(
            t('moment.mentionsIgnored', {
              count: comment.ignoredMentionCount,
            }),
          );
        }
      } catch (error) {
        // 与详情页同款：保留输入内容让用户重试，并弹错误提示（reject 让输入框不关闭）。
        Alert.alert(
          t('moment.commentFailedTitle', { defaultValue: '评论失败' }),
          getApiErrorMessage(
            error,
            t('moment.commentFailedMessage', {
              defaultValue: '网络异常，请稍后重试',
            }),
          ),
        );
        if (__DEV__) {
          console.warn('[MomentsFeed] addMomentComment failed', error);
        }
        throw error;
      }
    },
    [commentTarget, storeAddComment, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: MomentPost }) => (
      <MomentCard
        post={item}
        onLike={handleLike}
        onPress={handlePress}
        onComment={handleComment}
        onReplyComment={handleReplyComment}
      />
    ),
    [handleLike, handlePress, handleComment, handleReplyComment],
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
    <View style={s.feedContainer}>
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

      {commentTarget ? (
        <MomentCommentInput
          replyTo={commentTarget.replyTo}
          onSubmit={handleSubmitComment}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}
      <MomentMentionNotice
        message={mentionNotice}
        onDismiss={dismissMentionNotice}
      />
    </View>
  );
};
