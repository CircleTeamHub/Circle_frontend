import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import {
  cancelSignup,
  signupForPost,
  deletePlazaPost,
} from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { ImageGrid } from './image-grid';
import { RestrictionBadge } from './restriction-badge';
import type { CirclePlazaPost } from '@/types';

interface PlazaPostCardProps {
  post: CirclePlazaPost;
}

// "不限制" 徽章配色（绿色=开放给所有人），与 RestrictionBadge 的彩色徽章风格统一。
const OPEN_BADGE_COLOR = '#10B981';

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
  },
  headerText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  // 用户名过长时收缩并省略，圈子 badge 不收缩（RN flexShrink 默认 0），二者始终同行。
  nameShrink: {
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 3,
  },
  authorBadgeRow: {
    flexShrink: 0,
  },
  tag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 1,
    borderRadius: Radius.sm,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  conditionLabel: {
    ...Typography.tinyRegular,
    fontWeight: '600',
  },
  openBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  openBadgeText: {
    ...Typography.tinyRegular,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
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
        backgroundColor: colors.primary,
        borderRadius: Radius.sm,
      },
      tagText: {
        color: colors.white,
        ...Typography.tinyRegular,
        fontWeight: '600' as const,
      },
      body: {
        color: colors.text,
        fontSize: 14,
        lineHeight: 21,
      },
    }),
    [colors],
  );

  const [signed, setSigned] = useState(post.signedByMe);
  const [signupCount, setSignupCount] = useState(post.signupCount);
  const [busy, setBusy] = useState(false);

  const currentUserId = useAuthStore((state) => state.user?.id);
  const isOwnPost = !!currentUserId && currentUserId === post.author.id;

  const hasCondition =
    post.signupRestrictions.vipLevel != null ||
    post.signupRestrictions.creditScore != null ||
    post.signupRestrictions.fancyNumber;

  const handleManageSignups = useCallback(() => {
    // Stay within the discover stack so "back" returns to the plaza feed,
    // not the messages tab home.
    router.push({
      pathname: '/(tabs)/discover/post-signups',
      params: { postId: post.id, title: post.content.slice(0, 24) },
    });
  }, [router, post.id, post.content]);

  const storeRemovePlazaPost = useDiscoverStore((state) => state.removePlazaPost);

  const handleDeletePost = useCallback(() => {
    Alert.alert(
      t('plaza.deleteTitle', { defaultValue: '删除帖子' }),
      t('plaza.deleteMessage', {
        defaultValue: '删除后无法恢复，确定删除吗？',
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: '删除' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePlazaPost(post.id);
              storeRemovePlazaPost(post.id);
            } catch (error) {
              Alert.alert(
                t('plaza.deleteFailedTitle', { defaultValue: '删除失败' }),
                getApiErrorMessage(
                  error,
                  t('plaza.deleteFailedMessage', { defaultValue: '请稍后重试' }),
                ),
              );
            }
          },
        },
      ],
    );
  }, [post.id, storeRemovePlazaPost, t]);

  const buildSignupReasonText = useCallback((): string => {
    const reasons: string[] = [];
    if (post.signupRestrictions.vipLevel != null) {
      reasons.push(
        t('plaza.restriction.vipAtLeast', {
          level: post.signupRestrictions.vipLevel,
          defaultValue: `VIP${post.signupRestrictions.vipLevel}以上`,
        }),
      );
    }
    if (post.signupRestrictions.creditScore != null) {
      reasons.push(
        t('plaza.restriction.creditAtLeast', {
          score: post.signupRestrictions.creditScore,
          defaultValue: `信用值${post.signupRestrictions.creditScore}以上`,
        }),
      );
    }
    if (post.signupRestrictions.fancyNumber) {
      reasons.push(
        t('plaza.restriction.fancyNumber', { defaultValue: '靓号用户' }),
      );
    }
    const separator = t('plaza.restriction.separator', { defaultValue: '、' });
    return reasons.join(separator);
  }, [post.signupRestrictions, t]);

  const handleToggleSignup = useCallback(async () => {
    if (busy) return;
    // 取消报名不校验门槛；仅当未报名且不满足资格时拦截并提示。
    if (!signed && !post.canSignup) {
      Alert.alert(
        t('plaza.signupBlockedTitle', { defaultValue: '暂不可报名' }),
        t('plaza.signupRestrictionMessage', {
          requirements: buildSignupReasonText(),
          defaultValue: `报名需满足：${buildSignupReasonText()}`,
        }),
      );
      return;
    }
    setBusy(true);
    const next = !signed;
    // 乐观更新
    setSigned(next);
    setSignupCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = next
        ? await signupForPost(post.id)
        : await cancelSignup(post.id);
      setSigned(res.signed);
      setSignupCount(res.signupCount);
    } catch {
      // 回滚
      setSigned(!next);
      setSignupCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }, [busy, signed, post.id, post.canSignup, buildSignupReasonText, t]);

  const handleAvatarPress = useCallback(() => {
    if (!post.canInteract) {
      const reasons: string[] = [];
      if (post.restrictions.vipLevel != null) {
        reasons.push(
          t('plaza.restriction.vipAtLeast', {
            level: post.restrictions.vipLevel,
            defaultValue: `VIP${post.restrictions.vipLevel}以上`,
          }),
        );
      }
      if (post.restrictions.creditScore != null) {
        reasons.push(
          t('plaza.restriction.creditAtLeast', {
            score: post.restrictions.creditScore,
            defaultValue: `信用值${post.restrictions.creditScore}以上`,
          }),
        );
      }
      if (post.restrictions.fancyNumber) {
        reasons.push(
          t('plaza.restriction.fancyNumber', { defaultValue: '靓号用户' }),
        );
      }
      const separator = t('plaza.restriction.separator', {
        defaultValue: '、',
      });
      Alert.alert(
        t('plaza.cannotView'),
        t('plaza.restrictionMessage', {
          requirements: reasons.join(separator),
        }),
      );
      return;
    }
    router.push(getUserProfileHref('discover', post.author.id));
  }, [post.canInteract, post.restrictions, post.author.id, router, t]);

  const timeLabel = useMemo(
    () => formatRelativeTime(post.createdAt, t),
    [post.createdAt, t],
  );
  const authorDisplayIcons = post.author.displayIcons ?? [];

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
          <View style={s.nameRow}>
            <Pressable onPress={handleAvatarPress} style={s.nameShrink}>
              <Text style={d.authorName} numberOfLines={1}>
                {post.author.nickname}
              </Text>
            </Pressable>
            <View style={[s.tag, d.tag]}>
              <Text style={d.tagText} numberOfLines={1}>
                {post.circles?.length
                  ? post.circles[0].name +
                    (post.circles.length > 1
                      ? ` +${post.circles.length - 1}`
                      : '')
                  : post.circle.name}
              </Text>
            </View>
            {authorDisplayIcons.length > 0 ? (
              <View style={s.authorBadgeRow}>
                <UserIconRow icons={authorDisplayIcons} compact compactSize="small" />
              </View>
            ) : null}
          </View>
          <View style={s.metaRow}>
            {post.cities?.length || post.city ? (
              <Text style={d.metaText} numberOfLines={1}>
                {post.cities?.length ? post.cities.join(' · ') : post.city}
              </Text>
            ) : null}
            <Text style={d.metaText}>· {timeLabel}</Text>
          </View>
        </View>
        {post.isHorn ? (
          <Ionicons name="megaphone" size={18} color={colors.warning} />
        ) : null}
        {isOwnPost ? (
          <Pressable
            onPress={handleDeletePost}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.delete', { defaultValue: '删除' })}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
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

      {/* 报名条件: 始终显示；绑定 signup-restriction 集（后端 403 实际校验的那套），
          无门槛时显示"不限制"，让作者/浏览者都能一眼看到报名门槛。 */}
      <View style={s.conditionRow}>
        <Text style={[s.conditionLabel, { color: colors.textSecondary }]}>
          {t('plaza.signupCondition', { defaultValue: '报名条件：' })}
        </Text>
        {hasCondition ? (
          <RestrictionBadge restrictions={post.signupRestrictions} />
        ) : (
          <View style={[s.openBadge, { backgroundColor: OPEN_BADGE_COLOR }]}>
            <Ionicons name="earth-outline" size={10} color={colors.white} />
            <Text style={[s.openBadgeText, { color: colors.white }]}>
              {t('common.noRestriction', { defaultValue: '不限制' })}
            </Text>
          </View>
        )}
      </View>

      {/* Footer：自己的帖子显示报名人数(点击进入报名管理),否则显示报名按钮 */}
      <View style={s.footer}>
        {isOwnPost ? (
          <Pressable
            onPress={handleManageSignups}
            hitSlop={6}
            style={[s.signupBtn, { borderColor: colors.surfaceBorder }]}
          >
            <Ionicons name="people-outline" size={16} color={colors.primary} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primary }}>
              {t('plaza.manageSignups', {
                count: signupCount,
                defaultValue: '{{count}} 人报名',
              })}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleToggleSignup}
            disabled={busy}
            hitSlop={6}
            style={[
              s.signupBtn,
              {
                borderColor: signed ? colors.primary : colors.surfaceBorder,
                backgroundColor: signed ? colors.primary : 'transparent',
                opacity: !signed && !post.canSignup ? 0.5 : 1,
              },
            ]}
          >
            <Ionicons
              name={signed ? 'checkmark-circle' : 'person-add-outline'}
              size={16}
              color={signed ? colors.white : colors.textSecondary}
            />
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: signed ? colors.white : colors.textSecondary,
              }}
            >
              {signed
                ? t('plaza.signedUp', { defaultValue: '已报名' })
                : t('plaza.signUp', { defaultValue: '报名' })}
              {signupCount > 0 ? ` ${signupCount}` : ''}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};
