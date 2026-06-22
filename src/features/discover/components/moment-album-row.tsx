import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import { getAlbumDateParts } from '@/features/discover/utils/album-date';
import { ImageGrid } from './image-grid';
import type { MomentPost } from '@/types';

const DATE_COL_WIDTH = 56;

interface MomentAlbumRowProps {
  post: MomentPost;
  showDate: boolean;
  onPress: (postId: string) => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  dateCol: {
    width: DATE_COL_WIDTH,
    alignItems: 'flex-start',
  },
  dayText: {
    ...Typography.h1,
  },
  monthText: {
    ...Typography.small,
    marginTop: Spacing.xs / 2,
  },
  body: {
    flex: 1,
    gap: Spacing.sm,
  },
  content: {
    ...Typography.bodyRegular,
    lineHeight: 21,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
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
});

export const MomentAlbumRow: React.FC<MomentAlbumRowProps> = ({
  post,
  showDate,
  onPress,
}) => {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const dateParts = useMemo(
    () => getAlbumDateParts(post.createdAt, i18n.language),
    [post.createdAt, i18n.language],
  );
  const timeLabel = useMemo(
    () => formatRelativeTime(post.createdAt, t),
    [post.createdAt, t],
  );

  const d = useMemo(
    () => ({
      dayText: { color: colors.text },
      monthText: { color: colors.textSecondary },
      content: { color: colors.text },
      timeText: { color: colors.textSecondary, ...Typography.small },
      socialBlock: { backgroundColor: colors.surface },
      likeText: { color: colors.primary, ...Typography.caption },
      commentUser: {
        color: colors.primary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      commentText: { color: colors.text, ...Typography.caption },
    }),
    [colors],
  );

  // 内容列宽 = 屏宽 - 左右页边距 - 日期列 - 行内 gap
  const contentWidth =
    screenWidth - Spacing.lg * 2 - DATE_COL_WIDTH - Spacing.md;

  const comments = post.comments ?? [];
  const likedFriends = post.likedFriends ?? [];

  return (
    <View style={s.row}>
      <View style={s.dateCol}>
        {showDate ? (
          <>
            <Text style={[s.dayText, d.dayText]}>{dateParts.day}</Text>
            <Text style={[s.monthText, d.monthText]}>{dateParts.month}</Text>
          </>
        ) : null}
      </View>

      <View style={s.body}>
        {post.content ? (
          <Pressable onPress={() => onPress(post.id)}>
            <Text style={[s.content, d.content]}>{post.content}</Text>
          </Pressable>
        ) : null}

        {post.images.length > 0 ? (
          <Pressable onPress={() => onPress(post.id)}>
            <ImageGrid images={post.images} containerWidth={contentWidth} />
          </Pressable>
        ) : null}

        <View style={s.footerRow}>
          <Text style={d.timeText}>{timeLabel}</Text>
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
