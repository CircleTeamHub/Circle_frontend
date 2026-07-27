import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { getMembershipFrameAsset } from '@/features/profile/membership-frames';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import { getPostExpiryTier } from '@/features/discover/utils/plaza-post-expiry';
import {
  cancelSignup,
  signupForPost,
  deletePlazaPost,
  reportPlazaPost,
} from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { ImageGrid } from './image-grid';
import { RestrictionBadge } from './restriction-badge';
import {
  PlazaPostActionsSheet,
  type PostAction,
} from './plaza-post-actions-sheet';
import type { CirclePlazaPost, DisplayIcon, SystemIconKey } from '@/types';

interface PlazaPostCardProps {
  post: CirclePlazaPost;
}

// "不限制" 徽章配色（绿色=开放给所有人），与 RestrictionBadge 的彩色徽章风格统一。
const OPEN_BADGE_COLOR = '#10B981';

// 广场卡头部只固定展示 3 枚徽章且不折叠 "+N"，因此按「身份/信誉」优先级排序，优先露出
// VIP 和信誉相关（VERIFIED_PROFILE 认证 / TOP_COLLABORATOR 协作口碑）徽章；圈子(CIRCLE)
// 徽章、新人徽章靠后。同优先级保持服务端的 sortOrder。
const BADGE_DISPLAY_PRIORITY: Record<SystemIconKey, number> = {
  VIP: 0,
  VERIFIED_PROFILE: 1,
  TOP_COLLABORATOR: 2,
  CIRCLE_BUILDER: 3,
  NEW_USER: 4,
};

function badgeDisplayRank(icon: DisplayIcon): number {
  if (
    icon.type === 'SYSTEM' &&
    icon.systemKey &&
    icon.systemKey in BADGE_DISPLAY_PRIORITY
  ) {
    return BADGE_DISPLAY_PRIORITY[icon.systemKey];
  }
  // 圈子徽章 / 未知 systemKey 排在所有系统身份徽章之后。
  return 100;
}

const s = StyleSheet.create({
  // 活动卡片左侧强调竖条 —— 给广场帖一个「活动」身份，普通 horn 用橙、常规用主色。
  // 卡片 overflow:hidden 让竖条顶到圆角内被裁切，观感干净。
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
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
  // 第一行只剩用户名 + 身份徽章（圈子标签已下移到第二行）。用户名给最低收缩权重
  // + minWidth 兜底：溢出时省略而非被挤没，短名（如"丁哥"）完整显示。
  nameShrink: {
    flexShrink: 1,
    minWidth: 32,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 4,
  },
  // 第二行的城市文本：可收缩省略，过长时先让位给圈子标签/时间，而不是把时间挤没。
  metaCity: {
    flexShrink: 1,
    minWidth: 0,
  },
  authorBadgeRow: {
    flexShrink: 0,
  },
  tag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 1,
    borderRadius: Radius.sm,
    // 圈子标签在第二行：仅设宽度上限（圈子名过长时省略），不参与收缩，让城市文本先让位。
    maxWidth: 132,
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
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surfaceBorder,
        padding: Spacing.md,
        paddingLeft: Spacing.md + 4,
        gap: Spacing.md - 4,
        overflow: 'hidden' as const,
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
  const [menuVisible, setMenuVisible] = useState(false);

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

  const handleShare = useCallback(() => {
    // 分享到对话：进好友选择页，选中后把帖子作为聊天卡片发到该会话。
    router.push({
      pathname: '/(tabs)/discover/share-post',
      params: { postId: post.id },
    });
  }, [router, post.id]);

  const handleReport = useCallback(() => {
    Alert.alert(
      t('plaza.report.title', { defaultValue: '举报帖子' }),
      t('plaza.report.message', { defaultValue: '确定要举报这条帖子吗？' }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('plaza.report.confirm', { defaultValue: '举报' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await reportPlazaPost(post.id);
              Alert.alert(
                t('plaza.report.doneTitle', { defaultValue: '已举报' }),
                t('plaza.report.doneMessage', {
                  defaultValue: '感谢反馈，我们会尽快处理。',
                }),
              );
            } catch (error) {
              Alert.alert(
                t('plaza.report.failedTitle', { defaultValue: '举报失败' }),
                getApiErrorMessage(
                  error,
                  t('plaza.report.failedMessage', { defaultValue: '请稍后重试' }),
                ),
              );
            }
          },
        },
      ],
    );
  }, [post.id, t]);

  const postActions = useMemo<PostAction[]>(() => {
    const actions: PostAction[] = [
      {
        key: 'share',
        label: t('plaza.actions.share', { defaultValue: '分享' }),
        icon: 'share-outline',
        onPress: handleShare,
      },
    ];
    // 自己的帖子可删除；别人的帖子可举报。删除从原右上角独立按钮移入此菜单。
    if (isOwnPost) {
      actions.push({
        key: 'delete',
        label: t('common.delete', { defaultValue: '删除' }),
        icon: 'trash-outline',
        destructive: true,
        onPress: handleDeletePost,
      });
    } else {
      actions.push({
        key: 'report',
        label: t('plaza.actions.report', { defaultValue: '举报' }),
        icon: 'flag-outline',
        destructive: true,
        onPress: handleReport,
      });
    }
    return actions;
  }, [t, isOwnPost, handleShare, handleDeletePost, handleReport]);

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
  // 不可变排序（不改 post.author.displayIcons）：优先 VIP + 信誉相关徽章，同级保持
  // 服务端 sortOrder。头部只取前 3 枚且不折叠，排序保证露出的是最重要的身份徽章。
  const authorDisplayIcons = useMemo(() => {
    const icons = post.author.displayIcons ?? [];
    return [...icons].sort((a, b) => {
      const rankDiff = badgeDisplayRank(a) - badgeDisplayRank(b);
      if (rankDiff !== 0) return rankDiff;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }, [post.author.displayIcons]);

  // 左侧强调竖条配色按「距到期的剩余时间」分档，随时间推移逐级跳变：≤1天(橙) →
  // ≤3天(绿) → 更久(紫)。越接近到期越暖，推动及时报名（不用红色，观感更柔和）。
  const accentColor = useMemo(() => {
    const tier = getPostExpiryTier(post.expiresAt);
    if (tier === 'urgent') return colors.warning;
    if (tier === 'soon') return colors.success;
    return colors.primary;
  }, [post.expiresAt, colors]);

  return (
    <View style={d.card}>
      {/* 左侧「活动」强调竖条：配色随距到期剩余时间逐级跳变(>3天紫→≤3天绿→≤1天橙)。 */}
      <View style={[s.accent, { backgroundColor: accentColor }]} />
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={handleAvatarPress}>
          <Avatar
            size={40}
            name={post.author.nickname}
            uri={post.author.avatarUrl ?? undefined}
            frameSource={getMembershipFrameAsset(post.author.vipLevel) ?? undefined}
            compactFrame
          />
        </Pressable>
        <View style={s.headerText}>
          <View style={s.nameRow}>
            <Pressable onPress={handleAvatarPress} style={s.nameShrink}>
              <MemberName
                name={post.author.nickname}
                userId={post.author.id}
                vipLevel={post.author.vipLevel}
                style={d.authorName}
                numberOfLines={1}
              />
            </Pressable>
            {authorDisplayIcons.length > 0 ? (
              <View style={s.authorBadgeRow}>
                {/* 第一行只剩用户名 + 身份徽章（圈子标签已下移）：固定展示前 3 枚，
                    超出不折叠 "+N"（icons 已按 VIP + 信誉优先排序）。 */}
                <UserIconRow
                  icons={authorDisplayIcons}
                  compact
                  compactSize="small"
                  maxVisible={3}
                  showOverflowCount={false}
                />
              </View>
            ) : null}
          </View>
          <View style={s.metaRow}>
            {/* 圈子标签下移到第二行，作为「归属」锚点，与城市 · 时间同排。 */}
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
            {post.cities?.length || post.city ? (
              <Text style={[d.metaText, s.metaCity]} numberOfLines={1}>
                {post.cities?.length ? post.cities.join(' · ') : post.city}
              </Text>
            ) : null}
            <Text style={d.metaText}>· {timeLabel}</Text>
          </View>
        </View>
        {post.isHorn ? (
          <Ionicons name="megaphone" size={18} color={colors.warning} />
        ) : null}
        {/* 右上角「更多」：分享 / 举报 / 删除（删除已从独立按钮移入此菜单）。 */}
        <Pressable
          onPress={() => setMenuVisible(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('plaza.actions.more', { defaultValue: '更多' })}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
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
              // 未报名 = 实心主色强 CTA（推动及时报名）；已报名 = 克制的成功色描边确认态。
              signed
                ? { borderColor: colors.success, backgroundColor: 'transparent' }
                : {
                    borderColor: colors.primary,
                    backgroundColor: colors.primary,
                    opacity: post.canSignup ? 1 : 0.5,
                  },
            ]}
          >
            <Ionicons
              name={signed ? 'checkmark-circle' : 'person-add'}
              size={16}
              color={signed ? colors.success : colors.white}
            />
            <Text
              style={{
                fontSize: 13,
                fontWeight: '700',
                color: signed ? colors.success : colors.white,
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

      <PlazaPostActionsSheet
        visible={menuVisible}
        actions={postActions}
        onClose={() => setMenuVisible(false)}
      />
    </View>
  );
};
