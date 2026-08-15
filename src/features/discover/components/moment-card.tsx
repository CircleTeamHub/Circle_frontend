import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
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
  /** 点评论按钮：就地评论（缺省时退回跳详情）。 */
  onComment?: (postId: string) => void;
  /** 点已有评论：就地回复该评论（缺省时退回跳详情）。 */
  onReplyComment?: (
    postId: string,
    replyTo: { id: string; nickname: string },
  ) => void;
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
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.xs,
  },
  timeText: {
    ...Typography.small,
  },
});

export const MomentCard: React.FC<MomentCardProps> = ({
  post,
  onLike,
  onPress,
  onComment,
  onReplyComment,
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
  // 回复目标的会员特效要按「被回复用户」的 id 补查:replyTo.id 是父**评论** id(后端
  // replyToID 引用另一条评论),不是用户 id。拿它当 userId 会去 /user/vip-levels 查评论
  // UUID——永远查不到、回复名字永不亮、还每条多一次废请求。这里映射到父评论作者的
  // user.id;父评论不在已加载列表里时回落 null(不查也不错发)。
  const replyTargetUserIdByCommentId = useMemo(
    () => new Map(comments.map((c) => [c.id, c.user.id])),
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
            <MemberName
              name={post.author.nickname}
              userId={post.author.id}
              vipLevel={post.author.vipLevel}
              style={d.authorName}
            />
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
            <Pressable
              style={s.actionBtn}
              hitSlop={8}
              onPress={() => onLike(post.id)}
            >
              <Ionicons
                name={post.isLikedByMe ? 'heart' : 'heart-outline'}
                size={24}
                color={post.isLikedByMe ? colors.error : colors.textSecondary}
              />
              {post.likeCount > 0 ? (
                <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
                  {post.likeCount}
                </Text>
              ) : null}
            </Pressable>
            <Pressable
              style={s.actionBtn}
              hitSlop={8}
              onPress={() => (onComment ?? onPress)(post.id)}
            >
              <Ionicons
                name="chatbubble-outline"
                size={22}
                color={colors.textSecondary}
              />
              {post.commentCount > 0 ? (
                <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
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
                  {likedFriendsPreview.friends.map((friend, index) => (
                    <Text key={friend.id}>
                      {index > 0 ? likedFriendsPreview.separator : ''}
                      <MemberName
                        name={friend.nickname}
                        userId={friend.id}
                        style={d.likeText}
                      />
                    </Text>
                  ))}
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
                  onPress={() =>
                    onReplyComment
                      ? onReplyComment(post.id, {
                          id: thread.comment.id,
                          nickname: thread.comment.user.nickname,
                        })
                      : onPress(post.id)
                  }
                >
                  <MemberName
                    name={thread.comment.user.nickname}
                    userId={thread.comment.user.id}
                    style={d.commentUser}
                  />
                  {thread.comment.replyTo ? (
                    <>
                      <Text style={d.commentText}>
                        {' '}{t('moment.reply')}{' '}
                      </Text>
                      <MemberName
                        name={thread.comment.replyTo.nickname}
                        userId={
                          replyTargetUserIdByCommentId.get(
                            thread.comment.replyTo.id,
                          ) ?? null
                        }
                        style={d.commentUser}
                      />
                    </>
                  ) : null}
                  <Text style={d.commentText}>
                    : {thread.comment.content}
                    {thread.comment.images?.length
                      ? `${thread.comment.content ? ' ' : ''}${t('moment.imageTag', { defaultValue: '[图片]' })}`
                      : ''}
                  </Text>
                </Pressable>

                {thread.replies.map((reply) => (
                  <Pressable
                    key={reply.id}
                    style={[s.commentRow, s.replyRow]}
                    onPress={() =>
                      onReplyComment
                        ? onReplyComment(post.id, {
                            id: reply.id,
                            nickname: reply.user.nickname,
                          })
                        : onPress(post.id)
                    }
                  >
                    <MemberName
                      name={reply.user.nickname}
                      userId={reply.user.id}
                      style={d.commentUser}
                    />
                    {reply.replyTo ? (
                      <>
                        <Text style={d.commentText}>
                          {' '}{t('moment.reply')}{' '}
                        </Text>
                        <MemberName
                          name={reply.replyTo.nickname}
                          userId={
                            replyTargetUserIdByCommentId.get(
                              reply.replyTo.id,
                            ) ?? null
                          }
                          style={d.commentUser}
                        />
                      </>
                    ) : null}
                    <Text style={d.commentText}>
                      : {reply.content}
                      {reply.images?.length
                        ? `${reply.content ? ' ' : ''}${t('moment.imageTag', { defaultValue: '[图片]' })}`
                        : ''}
                    </Text>
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
