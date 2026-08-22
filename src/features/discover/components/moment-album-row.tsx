import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useContentColumnWidth } from '@/components/app/desktop-centered-column';
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
  const availableWidth = useContentColumnWidth();

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

  // 内容列宽 = 可用宽 - 左右页边距 - 日期列 - 行内 gap
  // （桌面网页版里"可用宽"是居中栏宽，不是视口宽，否则整行溢出栏外。）
  const contentWidth =
    availableWidth - Spacing.lg * 2 - DATE_COL_WIDTH - Spacing.md;

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
          <ImageGrid images={post.images} containerWidth={contentWidth} />
        ) : null}

        {/* 时间戳兼作详情入口。纯图片、没有评论的帖子（相册里很常见）此前
            没有任何可点的地方进详情：正文链接不渲染，图片被大图查看器接管，
            点赞/评论块整块不显示 —— 那条动态在相册里就成了死胡同。 */}
        <Pressable
          style={s.footerRow}
          onPress={() => onPress(post.id)}
          accessibilityRole="button"
          accessibilityLabel={t('moment.openDetail', {
            defaultValue: '查看动态详情',
          })}
        >
          <Text style={d.timeText}>{timeLabel}</Text>
        </Pressable>

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
