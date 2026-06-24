import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
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
  const { t } = useTranslation();
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
      actionIcon: { color: colors.textSecondary },
      actionIconActive: { color: colors.error },
    }),
    [colors],
  );

  const timeLabel = useMemo(
    () => formatRelativeTime(post.createdAt, t),
    [post.createdAt, t],
  );
  const comments = post.comments ?? [];
  const likedFriends = post.likedFriends ?? [];

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

        {likedFriends.length > 0 || comments.length > 0 ? (
          <View style={[s.socialBlock, d.socialBlock]}>
            {likedFriends.length > 0 ? (
              <View style={s.likesRow}>
                <Ionicons name="heart" size={13} color={colors.warning} />
                <Text style={d.likeText}>
                  {likedFriends.map((friend) => friend.nickname).join('、')}
                </Text>
              </View>
            ) : null}

            {comments.map((comment) => (
              <Pressable
                key={comment.id}
                style={s.commentRow}
                onPress={() => onPress(post.id)}
              >
                <Text style={d.commentUser}>{comment.user.nickname}</Text>
                {comment.replyTo ? (
                  <>
                    <Text style={d.commentText}>
                      {' '}{t('moment.reply')}{' '}
                    </Text>
                    <Text style={d.commentUser}>
                      {comment.replyTo.nickname}
                    </Text>
                  </>
                ) : null}
                <Text style={d.commentText}>: {comment.content}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
};
