import { useCallback, useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { ImageGrid } from './image-grid';
import { RestrictionBadge } from './restriction-badge';
import type { CirclePlazaPost } from '@/types';

interface PlazaPostCardProps {
  post: CirclePlazaPost;
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
  },
  headerText: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  tag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 1,
    borderRadius: Radius.full,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});

export const PlazaPostCard: React.FC<PlazaPostCardProps> = ({ post }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const d = useMemo(
    () => ({
      card: {
        backgroundColor: colors.surface,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        gap: Spacing.md - 4,
      },
      authorName: {
        color: colors.text,
        fontSize: 14,
        fontWeight: '600' as const,
      },
      metaText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      tag: {
        backgroundColor: colors.primaryLight,
      },
      tagText: {
        color: colors.primary,
        ...Typography.tinyRegular,
        fontWeight: '600' as const,
      },
      body: {
        color: colors.text,
        fontSize: 14,
        lineHeight: 21,
      },
      viewText: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
    }),
    [colors],
  );

  const handleAvatarPress = useCallback(() => {
    if (!post.canInteract) {
      const reasons: string[] = [];
      if (
        post.restrictions.vipLevel != null
      ) {
        reasons.push(`VIP${post.restrictions.vipLevel}以上`);
      }
      if (post.restrictions.creditScore != null) {
        reasons.push(`信用值${post.restrictions.creditScore}以上`);
      }
      if (post.restrictions.fancyNumber) {
        reasons.push('靓号用户');
      }
      Alert.alert(
        t('plaza.cannotView'),
        t('plaza.restrictionMessage', { requirements: reasons.join('、') }),
      );
      return;
    }
    router.push(getUserProfileHref('discover', post.author.id));
  }, [post.canInteract, post.restrictions, post.author.id, router, t]);

  const timeLabel = useMemo(() => {
    const diff = Date.now() - new Date(post.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.justNow');
    if (mins < 60) return t('common.minutesAgo', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('common.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('common.daysAgo', { count: days });
  }, [post.createdAt, t]);

  return (
    <View style={d.card}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={handleAvatarPress}>
          <Avatar
            size={40}
            name={post.author.nickname}
            uri={post.author.avatarUrl ?? undefined}
          />
        </Pressable>
        <View style={s.headerText}>
          <Pressable onPress={handleAvatarPress}>
            <Text style={d.authorName}>{post.author.nickname}</Text>
          </Pressable>
          <View style={s.metaRow}>
            <View style={[s.tag, d.tag]}>
              <Text style={d.tagText}>{post.circle.name}</Text>
            </View>
            {post.city ? (
              <Text style={d.metaText}>{post.city}</Text>
            ) : null}
            <Text style={d.metaText}>· {timeLabel}</Text>
          </View>
        </View>
        {post.isHorn ? (
          <Ionicons name="megaphone" size={18} color={colors.warning} />
        ) : null}
      </View>

      {/* Body */}
      <Text style={d.body}>{post.content}</Text>

      {/* Tags */}
      {post.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {post.tags.map((tag) => (
            <Text key={tag} style={{ color: colors.primary, ...Typography.caption }}>
              #{tag}
            </Text>
          ))}
        </View>
      ) : null}

      {/* Images */}
      <ImageGrid images={post.images} />

      {/* Restrictions */}
      <RestrictionBadge restrictions={post.restrictions} />

      {/* Footer */}
      <View style={s.footer}>
        <View style={s.viewCount}>
          <Ionicons name="eye-outline" size={14} color={colors.textSecondary} />
          <Text style={d.viewText}>{post.viewCount}</Text>
        </View>
      </View>
    </View>
  );
};
