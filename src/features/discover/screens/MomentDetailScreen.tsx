import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type FlatList as FlatListType,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ImageGrid } from '@/features/discover/components/image-grid';
import { MomentCommentInput } from '@/features/discover/components/moment-comment-input';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import {
  buildMomentCommentThreads,
  flattenMomentCommentThreads,
  type MomentCommentRow,
} from '@/features/discover/utils/moment-comments';
import { getUserProfileHref } from '@/features/user/utils/routes';
import {
  toggleMomentLike,
  addMomentComment,
  fetchMomentById,
  deleteMoment,
  deleteMomentComment,
} from '@/services/api/moments';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';
import { useAuthStore } from '@/stores/authStore';
import { ApiError } from '@/services/api/client';
import { getApiErrorMessage } from '@/services/api/errors';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import type { MomentPost } from '@/types';

// Unified icon scale for the post action row so like / comment read as one
// system instead of 26 / 24.
const IconSize = {
  action: 22,
} as const;

const s = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg },
  postSection: { gap: Spacing.md, paddingVertical: Spacing.md },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + Spacing.xs,
  },
  authorName: { ...Typography.body, fontWeight: '600' },
  postContent: { ...Typography.bodyRegular, lineHeight: 22 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.xs,
  },
  timeText: { ...Typography.small },
  actionsRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingVertical: Spacing.xs,
  },
  countText: { ...Typography.caption },
  commentsHeader: {
    paddingVertical: Spacing.md,
  },
  commentsTitle: { ...Typography.h3 },
  detailRefreshError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  detailRefreshErrorText: {
    ...Typography.caption,
    flex: 1,
  },
  detailRefreshRetry: {
    ...Typography.caption,
    fontWeight: '600',
  },
  commentItem: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  replyItem: {
    marginLeft: Spacing.xl + Spacing.sm,
  },
  targetCommentHighlight: {
    borderRadius: Radius.md,
  },
  commentBody: { flex: 1, gap: Spacing.xs },
  commentUser: { ...Typography.caption, fontWeight: '600' },
  commentText: { ...Typography.bodyRegular, lineHeight: 20 },
  commentImage: {
    width: 140,
    height: 140,
    borderRadius: Radius.md,
  },
  commentTime: { ...Typography.small },
  replyLabel: { ...Typography.caption },
  emptyComments: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  // 底部常驻评论触发栏（仿抖音）：点击唤起 MomentCommentInput 浮层。
  commentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  commentBarPill: {
    flex: 1,
    height: 40,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  commentBarPlaceholder: {
    ...Typography.bodyRegular,
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function MomentDetailScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id, targetCommentId } = useLocalSearchParams<{
    id: string;
    targetCommentId?: string;
  }>();

  const storeMoment = useMomentsStore((s) =>
    s.moments.find((m) => m.id === id),
  );
  const storeToggleLike = useMomentsStore((s) => s.toggleLike);
  const storeAddComment = useMomentsStore((s) => s.addComment);
  const storeRemoveMoment = useMomentsStore((s) => s.removeMoment);
  const storeRemoveComment = useMomentsStore((s) => s.removeComment);
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [post, setPost] = useState<MomentPost | null>(storeMoment ?? null);
  const [loading, setLoading] = useState(!storeMoment);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const postRef = useRef<MomentPost | null>(storeMoment ?? null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const listRef = useRef<FlatListType<MomentCommentRow>>(null);
  const scrolledToTargetCommentRef = useRef<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(
    null,
  );
  const [commentTarget, setCommentTarget] = useState<{
    replyTo: { id: string; nickname: string } | null;
  } | null>(null);

  useEffect(() => {
    postRef.current = post;
  }, [post]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Use the store as an initial preview, but do not let feed preview comments
  // overwrite the full detail payload after the detail fetch completes.
  useEffect(() => {
    if (storeMoment) {
      setPost((current) => current ?? storeMoment);
    }
  }, [storeMoment]);

  const loadMoment = useCallback(async () => {
    if (!id) {
      return;
    }

    const requestId = ++requestRef.current;
    const hasPreviewPost = Boolean(postRef.current);
    if (!hasPreviewPost) {
      setLoading(true);
    }
    setLoadError(null);

    try {
      const found = await fetchMomentById(id);
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setPost(found);
    } catch (error) {
      if (!mountedRef.current || requestId !== requestRef.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setPost(null);
        setLoadError(t('moment.notExist'));
        return;
      }

      setLoadError(getApiErrorMessage(error, t('moment.loadFailed')));
    } finally {
      if (
        mountedRef.current &&
        requestId === requestRef.current &&
        !hasPreviewPost
      ) {
        setLoading(false);
      }
    }
  }, [id, t]);

  // Fallback: fetch from API if not in store
  useEffect(() => {
    void loadMoment();
  }, [loadMoment]);

  useEffect(() => {
    void markMatchingTargetNotificationsRead({
      traceId: id,
      replyId: targetCommentId,
    });
  }, [id, targetCommentId]);

  const handleRefreshMoment = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadMoment();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadMoment]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      authorName: { color: colors.primary },
      postContent: { color: colors.text },
      timeText: { color: colors.textSecondary },
      commentsTitle: { color: colors.text },
      commentUser: { color: colors.primary },
      commentText: { color: colors.text },
      commentTime: { color: colors.textSecondary },
      replyLabel: { color: colors.textSecondary },
      detailRefreshError: { backgroundColor: colors.surface },
      detailRefreshErrorText: { color: colors.textSecondary },
      detailRefreshRetry: { color: colors.primary },
      targetCommentHighlight: { backgroundColor: colors.primaryLight },
      emptyText: { color: colors.textSecondary, ...Typography.body },
    }),
    [colors],
  );

  const handleLike = useCallback(async () => {
    if (!post) return;
    const optimisticLiked = !post.isLikedByMe;
    const optimisticCount = post.likeCount + (optimisticLiked ? 1 : -1);

    setPost((p) => p ? { ...p, isLikedByMe: optimisticLiked, likeCount: optimisticCount } : p);
    storeToggleLike(post.id, optimisticLiked, optimisticCount);

    try {
      const result = await toggleMomentLike(post.id);
      setPost((p) => p ? { ...p, isLikedByMe: result.liked, likeCount: result.likeCount } : p);
      storeToggleLike(post.id, result.liked, result.likeCount);
    } catch (error) {
      setPost((p) => p ? { ...p, isLikedByMe: post.isLikedByMe, likeCount: post.likeCount } : p);
      storeToggleLike(post.id, post.isLikedByMe, post.likeCount);
      if (__DEV__) {
        console.warn('[MomentDetailScreen] toggleMomentLike failed, rolled back', error);
      }
    }
  }, [post, storeToggleLike]);

  const handleSubmitComment = useCallback(
    async (content: string, replyToId?: string, images?: string[]) => {
      if (!post) return;
      try {
        const comment = await addMomentComment(post.id, {
          content,
          replyToId,
          images,
        });
        setPost((p) =>
          p
            ? { ...p, comments: [...p.comments, comment], commentCount: p.commentCount + 1 }
            : p,
        );
        storeAddComment(post.id, comment);
        setCommentTarget(null);
      } catch (error) {
        // 之前是 silent fail —— 输入框被 dismiss、评论没出现、用户没反馈。
        // 现在保留 commentTarget 让用户重试（含已输入文本），并弹错误提示。
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
          console.warn('[MomentDetailScreen] addMomentComment failed', error);
        }
        throw error;
      }
    },
    [post, storeAddComment, t],
  );

  const timeLabel = useMemo(
    () => (post ? formatRelativeTime(post.createdAt, t) : ''),
    [post, t],
  );
  const commentThreads = useMemo(
    () => buildMomentCommentThreads(post?.comments ?? []),
    [post?.comments],
  );
  const commentRows = useMemo(
    () => flattenMomentCommentThreads(commentThreads),
    [commentThreads],
  );
  useEffect(() => {
    if (
      !targetCommentId ||
      commentRows.length === 0 ||
      scrolledToTargetCommentRef.current === targetCommentId
    ) {
      return;
    }

    const index = commentRows.findIndex((row) => row.comment.id === targetCommentId);
    if (index < 0) {
      return;
    }

    scrolledToTargetCommentRef.current = targetCommentId;
    setHighlightedCommentId(targetCommentId);
    listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.35,
    });

    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setHighlightedCommentId(null);
      }
    }, 2200);
    return () => clearTimeout(timer);
  }, [commentRows, targetCommentId]);

  // Precompute each comment's formatted timestamp once per list/locale change,
  // instead of running Date + toLocaleString for every row on every render.
  const commentTimeById = useMemo(() => {
    const locale = i18n.language || 'zh-CN';
    const map = new Map<string, string>();
    for (const row of commentRows) {
      map.set(
        row.comment.id,
        new Date(row.comment.createdAt).toLocaleString(locale, {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    }
    return map;
  }, [commentRows, i18n.language]);

  const isOwner =
    !!currentUserId && !!post && currentUserId === post.author.id;

  const handleDeleteMoment = useCallback(() => {
    Alert.alert(
      t('moment.deleteTitle', { defaultValue: '删除动态' }),
      t('moment.deleteMessage', {
        defaultValue: '删除后无法恢复，确定删除吗？',
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: '删除' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMoment(id);
              storeRemoveMoment(id);
              router.back();
            } catch (error) {
              Alert.alert(
                t('moment.deleteFailedTitle', { defaultValue: '删除失败' }),
                getApiErrorMessage(
                  error,
                  t('moment.deleteFailedMessage', { defaultValue: '请稍后重试' }),
                ),
              );
            }
          },
        },
      ],
    );
  }, [id, router, storeRemoveMoment, t]);

  const handleDeleteComment = useCallback(
    (commentId: string) => {
      Alert.alert(
        t('moment.deleteCommentTitle', { defaultValue: '删除评论' }),
        t('moment.deleteCommentMessage', {
          defaultValue: '确定删除这条评论吗？',
        }),
        [
          {
            text: t('common.cancel', { defaultValue: '取消' }),
            style: 'cancel',
          },
          {
            text: t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteMomentComment(commentId);
                setPost((p) =>
                  p
                    ? {
                        ...p,
                        comments: p.comments.filter((c) => c.id !== commentId),
                        commentCount: Math.max(0, p.commentCount - 1),
                      }
                    : p,
                );
                storeRemoveComment(id, commentId);
              } catch (error) {
                Alert.alert(
                  t('moment.deleteFailedTitle', { defaultValue: '删除失败' }),
                  getApiErrorMessage(
                    error,
                    t('moment.deleteFailedMessage', {
                      defaultValue: '请稍后重试',
                    }),
                  ),
                );
              }
            },
          },
        ],
      );
    },
    [id, storeRemoveComment, t],
  );

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('moment.detail')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!post) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('moment.detail')} />
        <View style={s.centerLoader}>
          <Text style={d.emptyText}>
            {loadError ?? t('moment.notExist')}
          </Text>
          {loadError && loadError !== t('moment.notExist') ? (
            <Pressable
              onPress={loadMoment}
              style={{
                marginTop: Spacing.md,
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.sm,
                borderRadius: Radius.full,
                backgroundColor: colors.primary,
              }}
            >
              <Text style={{ color: colors.white, ...Typography.caption }}>
                {t('common.retry')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const renderCommentRow = ({ item }: { item: MomentCommentRow }) => (
    <View>
      <Pressable
        style={[
          s.commentItem,
          item.isReply ? s.replyItem : null,
          item.comment.id === highlightedCommentId
            ? [s.targetCommentHighlight, d.targetCommentHighlight]
            : null,
        ]}
        onPress={() =>
          setCommentTarget({
            replyTo: {
              id: item.comment.id,
              nickname: item.comment.user.nickname,
            },
          })
        }
        onLongPress={
          !!currentUserId && item.comment.user.id === currentUserId
            ? () => handleDeleteComment(item.comment.id)
            : undefined
        }
        delayLongPress={350}
      >
        <Avatar size={item.isReply ? 28 : 32} name={item.comment.user.nickname} />
        <View style={s.commentBody}>
          <Text style={[s.commentUser, d.commentUser]}>
            {item.comment.user.nickname}
            {item.comment.replyTo ? (
              <Text style={[s.replyLabel, d.replyLabel]}>
                {' '}{t('moment.reply')} {item.comment.replyTo.nickname}
              </Text>
            ) : null}
          </Text>
          {item.comment.content ? (
            <Text style={[s.commentText, d.commentText]}>{item.comment.content}</Text>
          ) : null}
          {item.comment.images?.length ? (
            <Image
              source={{ uri: item.comment.images[0] }}
              style={[s.commentImage, { backgroundColor: colors.surface }]}
              contentFit="cover"
            />
          ) : null}
          <Text style={[s.commentTime, d.commentTime]}>
            {commentTimeById.get(item.comment.id)}
          </Text>
        </View>
      </Pressable>
      <Divider />
    </View>
  );

  const commentCountLabel = post.commentCount > 0
    ? t('moment.commentsCount', { count: post.commentCount })
    : t('moment.comments');

  const ListHeader = (
    <View style={s.content}>
      {/* Post */}
      <View style={s.postSection}>
        <Pressable
          style={s.authorRow}
          onPress={() => router.push(getUserProfileHref('discover', post.author.id))}
        >
          <Avatar
            size={44}
            name={post.author.nickname}
            uri={post.author.avatarUrl ?? undefined}
          />
          <Text style={[s.authorName, d.authorName]}>{post.author.nickname}</Text>
        </Pressable>

        <Text style={[s.postContent, d.postContent]}>{post.content}</Text>
        <ImageGrid images={post.images} />

        <View style={s.metaRow}>
          <Text style={[s.timeText, d.timeText]}>{timeLabel}</Text>
          <View style={s.actionsRow}>
            <Pressable style={s.actionBtn} hitSlop={8} onPress={handleLike}>
              <Ionicons
                name={post.isLikedByMe ? 'heart' : 'heart-outline'}
                size={IconSize.action}
                color={post.isLikedByMe ? colors.error : colors.textSecondary}
              />
              {post.likeCount > 0 ? (
                <Text style={[s.countText, { color: colors.textSecondary }]}>
                  {post.likeCount}
                </Text>
              ) : null}
            </Pressable>
            <Pressable
              style={s.actionBtn}
              hitSlop={8}
              onPress={() => setCommentTarget({ replyTo: null })}
            >
              <Ionicons
                name="chatbubble-outline"
                size={IconSize.action}
                color={colors.textSecondary}
              />
              {post.commentCount > 0 ? (
                <Text style={[s.countText, { color: colors.textSecondary }]}>
                  {post.commentCount}
                </Text>
              ) : null}
            </Pressable>
          </View>
        </View>
      </View>

      <Divider />

      {/* Comments header */}
      <View style={s.commentsHeader}>
        {loadError && post ? (
          <View style={[s.detailRefreshError, d.detailRefreshError]}>
            <Text style={[s.detailRefreshErrorText, d.detailRefreshErrorText]}>
              {t('moment.detailRefreshFailed')}
            </Text>
            <Pressable onPress={loadMoment}>
              <Text style={[s.detailRefreshRetry, d.detailRefreshRetry]}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={[s.commentsTitle, d.commentsTitle]}>
          {commentCountLabel}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('moment.detail')}
        rightActions={
          isOwner
            ? [
                {
                  icon: 'trash-outline',
                  onPress: handleDeleteMoment,
                  accessibilityLabel: t('common.delete', {
                    defaultValue: '删除',
                  }),
                },
              ]
            : undefined
        }
      />
      <FlatList
        ref={listRef}
        data={commentRows}
        keyExtractor={(item) => item.id}
        renderItem={renderCommentRow}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: 100 }}
        refreshing={refreshing}
        onRefresh={handleRefreshMoment}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToIndex({
            index: Math.max(0, Math.min(info.highestMeasuredFrameIndex, info.index)),
            animated: false,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.35,
            });
          }, 250);
        }}
        ListEmptyComponent={
          <View style={s.emptyComments}>
            <Text style={d.emptyText}>{t('moment.noComments')}</Text>
          </View>
        }
      />

      {!commentTarget ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('discover.commentInput.barPlaceholder', {
            defaultValue: '有什么想法，展开说说',
          })}
          style={[
            s.commentBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.divider,
              paddingBottom: insets.bottom || Spacing.sm,
            },
          ]}
          onPress={() => setCommentTarget({ replyTo: null })}
        >
          <View
            style={[s.commentBarPill, { backgroundColor: colors.background }]}
          >
            <Text
              style={[s.commentBarPlaceholder, { color: colors.textSecondary }]}
            >
              {t('discover.commentInput.barPlaceholder', {
                defaultValue: '有什么想法，展开说说',
              })}
            </Text>
            <Ionicons
              name="happy-outline"
              size={20}
              color={colors.textSecondary}
            />
          </View>
        </Pressable>
      ) : null}

      {commentTarget ? (
        <MomentCommentInput
          replyTo={commentTarget.replyTo}
          onSubmit={handleSubmitComment}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}
    </View>
  );
}
