import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import {
  buildLikedFriendsPreview,
  buildMomentCommentThreads,
  getMomentCommentPreviewState,
} from '@/features/discover/utils/moment-comments';
import { ImageGrid } from './image-grid';
import type { MomentPost } from '@/types';

interface MomentCardProps {
  post: MomentPost;
  onLike: (postId: string) => void;
  onPress: (postId: string) => void;
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.sm + 2,
  },
  body: {
    flex: 1,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    ...Typography.bodyRegular,
    lineHeight: 21,
  },
  socialBlock: {
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  likesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  commentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  commentThread: {
    gap: 2,
  },
  replyRow: {
    paddingLeft: Spacing.md,
  },
  showMoreComments: {
    alignSelf: 'flex-start',
    paddingTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  timeText: {
    ...Typography.small,
  },
});

export const MomentCard: React.FC<MomentCardProps> = ({
  post,
  onLike,
  onPress,
}) => {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const d = useMemo(
    () => ({
      authorName: { color: colors.primary, ...Typography.body, fontWeight: '600' as const },
      content: { color: colors.text },
      timeText: { color: colors.textSecondary },
      socialBlock: { backgroundColor: colors.surface },
      likeIcon: { color: colors.warning },
      likeText: { color: colors.primary, ...Typography.caption },
      commentUser: { color: colors.primary, ...Typography.caption, fontWeight: '600' as const },
      commentText: { color: colors.text, ...Typography.caption },
      showMoreCommentsText: { color: colors.primary, ...Typography.caption },
      actionIcon: { color: colors.textSecondary },
      actionIconActive: { color: colors.error },
    }),
    [colors],
  );

  const timeLabel = useMemo(
    () => formatRelativeTime(post.createdAt, t),
    [post.createdAt, t],
  );
  const comments = useMemo(() => post.comments ?? [], [post.comments]);
  const likedFriends = useMemo(
    () => post.likedFriends ?? [],
    [post.likedFriends],
  );
  const likedFriendsPreview = useMemo(
    () => buildLikedFriendsPreview(likedFriends, i18n.language),
    [likedFriends, i18n.language],
  );
  const commentThreads = useMemo(
    () => buildMomentCommentThreads(comments),
    [comments],
  );
  const commentPreview = useMemo(
    () => getMomentCommentPreviewState(commentThreads, post.commentCount),
    [commentThreads, post.commentCount],
  );
  const visibleCommentThreads = commentPreview.visibleThreads;
  const hiddenCommentCount = commentPreview.hiddenCount;
  const moreLikedFriendsPrefix =
    likedFriendsPreview.separator === '、' ? '' : likedFriendsPreview.separator;

  const handleAvatarPress = useCallback(() => {
    router.push(getUserProfileHref('discover', post.author.id));
  }, [router, post.author.id]);

  return (
    <View style={s.card}>
      {/* Avatar */}
      <Pressable onPress={handleAvatarPress}>
        <Avatar
          size={40}
          name={post.author.nickname}
          uri={post.author.avatarUrl ?? undefined}
        />
      </Pressable>

      {/* Body */}
      <View style={s.body}>
        {/* Author + Time */}
        <View style={s.headerRow}>
          <Pressable onPress={handleAvatarPress}>
            <Text style={d.authorName}>{post.author.nickname}</Text>
          </Pressable>
        </View>

        {/* Content (tappable for detail) */}
        <Pressable onPress={() => onPress(post.id)}>
          <Text style={[s.content, d.content]}>{post.content}</Text>
        </Pressable>

        {/* Images */}
        <Pressable onPress={() => onPress(post.id)}>
          <ImageGrid images={post.images} />
        </Pressable>

        {/* Time + Actions */}
        <View style={s.headerRow}>
          <Text style={[s.timeText, d.timeText]}>{timeLabel}</Text>
          <View style={s.actionsRow}>
            <Pressable style={s.actionBtn} onPress={() => onLike(post.id)}>
              <Ionicons
                name={post.isLikedByMe ? 'heart' : 'heart-outline'}
                size={16}
                color={post.isLikedByMe ? colors.error : colors.textSecondary}
              />
              {post.likeCount > 0 ? (
                <Text style={{ color: colors.textSecondary, ...Typography.small }}>
                  {post.likeCount}
                </Text>
              ) : null}
            </Pressable>
            <Pressable style={s.actionBtn} onPress={() => onPress(post.id)}>
              <Ionicons
                name="chatbubble-outline"
                size={15}
                color={colors.textSecondary}
              />
              {post.commentCount > 0 ? (
                <Text style={{ color: colors.textSecondary, ...Typography.small }}>
                  {post.commentCount}
                </Text>
              ) : null}
            </Pressable>
          </View>
        </View>

        {likedFriends.length > 0 || visibleCommentThreads.length > 0 ? (
          <View style={[s.socialBlock, d.socialBlock]}>
            {likedFriends.length > 0 ? (
              <View style={s.likesRow}>
                <Ionicons name="heart" size={13} color={colors.warning} />
                <Text style={[d.likeText, { flex: 1 }]} numberOfLines={2}>
                  {likedFriendsPreview.namesText}
                  {likedFriendsPreview.hiddenCount > 0
                    ? `${moreLikedFriendsPrefix}${t('moment.moreLikedFriends', {
                        count: likedFriendsPreview.hiddenCount,
                      })}`
                    : ''}
                </Text>
              </View>
            ) : null}

            {visibleCommentThreads.map((thread) => (
              <View key={thread.comment.id} style={s.commentThread}>
                <Pressable
                  style={s.commentRow}
                  onPress={() => onPress(post.id)}
                >
                  <Text style={d.commentUser}>
                    {thread.comment.user.nickname}
                  </Text>
                  {thread.comment.replyTo ? (
                    <>
                      <Text style={d.commentText}>
                        {' '}{t('moment.reply')}{' '}
                      </Text>
                      <Text style={d.commentUser}>
                        {thread.comment.replyTo.nickname}
                      </Text>
                    </>
                  ) : null}
                  <Text style={d.commentText}>: {thread.comment.content}</Text>
                </Pressable>

                {thread.replies.map((reply) => (
                  <Pressable
                    key={reply.id}
                    style={[s.commentRow, s.replyRow]}
                    onPress={() => onPress(post.id)}
                  >
                    <Text style={d.commentUser}>{reply.user.nickname}</Text>
                    {reply.replyTo ? (
                      <>
                        <Text style={d.commentText}>
                          {' '}{t('moment.reply')}{' '}
                        </Text>
                        <Text style={d.commentUser}>
                          {reply.replyTo.nickname}
                        </Text>
                      </>
                    ) : null}
                    <Text style={d.commentText}>: {reply.content}</Text>
                  </Pressable>
                ))}
              </View>
            ))}

            {hiddenCommentCount > 0 ? (
              <Pressable
                style={s.showMoreComments}
                onPress={() => onPress(post.id)}
              >
                <Text style={d.showMoreCommentsText}>
                  {t('moment.showMoreComments', { count: hiddenCommentCount })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
};
