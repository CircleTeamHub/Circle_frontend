import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import { buildRestrictionReasonText } from '@/features/discover/utils/plaza-restrictions';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getUserProfileHref, type CircleScope } from '@/features/user/utils/routes';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import {
  cancelSignup,
  signupForPost,
  deletePlazaPost,
  reportPlazaPost,
} from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { MomentMedia } from './moment-media';
import { RestrictionBadge } from './restriction-badge';
import {
  PlazaPostActionsSheet,
  type PostAction,
} from './plaza-post-actions-sheet';
import type { CirclePlazaPost, DisplayIcon, SystemIconKey } from '@/types';

interface PlazaPostCardProps {
  post: CirclePlazaPost;
  /** 删除成功后通知宿主列表(广场之外的列表不在广场 store 里,要自己移除)。 */
  onDeleted?: (postId: string) => void;
  onEdit?: () => void;
  showSignupAction?: boolean;
  showShareAction?: boolean;
  /**
   * 卡片所在的 tab 栈。圈子帖子页在消息/圈子/探索三个栈都有,点头像、报名管理要留在
   * 进来的那个 tab,不能跨 tab 压栈。广场只在圈子栈,默认 discover。
   */
  scope?: CircleScope;
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
  // 左侧竖条:告诉看帖的人「我能不能报」(配色见 accentColor)。
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
  // 报名条件在左、可换行收缩;按钮靠右不收缩。两样各占一行时右边全空着,合成一行。
  conditionRow: {
    flex: 1,
    minWidth: 0,
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
    gap: Spacing.sm,
  },
  signupBtn: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md - 4,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 44,
  },
});

export const PlazaPostCard: React.FC<PlazaPostCardProps> = ({
  post,
  onDeleted,
  onEdit,
  showSignupAction = true,
  showShareAction = true,
  scope = 'discover',
}) => {
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
        gap: Spacing.sm,
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
  const signupInFlightRef = useRef(false);
  const deferredSignupRef = useRef<{ signed: boolean; count: number } | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);

  useEffect(() => {
    // A refresh may finish during signup; the action's response owns that update.
    if (signupInFlightRef.current) {
      deferredSignupRef.current = { signed: post.signedByMe, count: post.signupCount };
      return;
    }
    setSigned(post.signedByMe);
    setSignupCount(post.signupCount);
  }, [post.signedByMe, post.signupCount]);

  const currentUserId = useAuthStore((state) => state.user?.id);
  const isOwnPost = !!currentUserId && currentUserId === post.author.id;
  const showInlineActions = isOwnPost && !!onEdit;

  const hasCondition =
    post.signupRestrictions.vipLevel != null ||
    post.signupRestrictions.creditScore != null ||
    (FEATURE_FLAGS.fancyNumbers && post.signupRestrictions.fancyNumber);

  const handleManageSignups = useCallback(() => {
    // 留在当前 tab 栈,返回时回到来时的列表。探索栈没有报名管理页,只能回落到圈子栈。
    router.push({
      pathname: `/(tabs)/${scope === 'explore' ? 'discover' : scope}/post-signups` as const,
      params: { postId: post.id, title: post.content.slice(0, 24) },
    });
  }, [router, post.id, post.content, scope]);

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
              onDeleted?.(post.id);
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
  }, [onDeleted, post.id, storeRemovePlazaPost, t]);

  const handleShare = useCallback(() => {
    // 分享到对话：进好友选择页，选中后把帖子作为聊天卡片发到该会话。
    router.push({
      pathname: scope === 'messages' ? '/(tabs)/messages/share-post' : '/(tabs)/discover/share-post',
      params: { postId: post.id },
    });
  }, [router, post.id, scope]);

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
    const actions: PostAction[] = [];
    if (showShareAction) {
      actions.push({
        key: 'share',
        label: t('plaza.actions.share', { defaultValue: '分享' }),
        icon: 'share-outline',
        onPress: handleShare,
      });
    }
    // 自己的帖子可删除；别人的帖子可举报。删除从原右上角独立按钮移入此菜单。
    if (isOwnPost) {
      if (onEdit) {
        actions.push({
          key: 'edit',
          label: t('plaza.actions.editPost'),
          icon: 'create-outline',
          onPress: onEdit,
        });
      }
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
  }, [t, isOwnPost, showShareAction, onEdit, handleShare, handleDeletePost, handleReport]);

  const buildSignupReasonText = useCallback(
    (): string =>
      buildRestrictionReasonText(post.signupRestrictions, t, {
        showFancyNumber: FEATURE_FLAGS.fancyNumbers,
      }),
    [post.signupRestrictions, t],
  );

  const handleToggleSignup = useCallback(async () => {
    if (signupInFlightRef.current) return;
    // 取消报名不校验门槛；仅当未报名且不满足资格时拦截并提示。
    if (!signed && !post.canSignup) {
      // 后端可能因为一个前端当前不展示的门槛(例如靓号)判定不可报名,这时
      // requirements 是空串,原来会弹出「报名需满足：」后面什么都没有。
      const requirements = buildSignupReasonText();
      Alert.alert(
        t('plaza.signupBlockedTitle', { defaultValue: '暂不可报名' }),
        requirements
          ? t('plaza.signupRestrictionMessage', {
              requirements,
              defaultValue: `报名需满足：${requirements}`,
            })
          : t('plaza.signupBlockedGeneric', {
              defaultValue: '你暂不满足该动态的报名条件',
            }),
      );
      return;
    }
    signupInFlightRef.current = true;
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
      const latest = deferredSignupRef.current;
      setSigned(latest?.signed ?? !next);
      setSignupCount((c) => latest?.count ?? Math.max(0, c + (next ? -1 : 1)));
    } finally {
      deferredSignupRef.current = null;
      signupInFlightRef.current = false;
      setBusy(false);
    }
  }, [signed, post.id, post.canSignup, buildSignupReasonText, t]);

  const handleAvatarPress = useCallback(() => {
    if (!post.canInteract) {
      // 和报名那条路一样：门槛只剩前端隐藏项（靓号）时 requirements 是空串，
      // 原来弹的是「需要 才能查看对方主页」这种半截话。
      const requirements = buildRestrictionReasonText(post.restrictions, t, {
        showFancyNumber: FEATURE_FLAGS.fancyNumbers,
      });
      Alert.alert(
        t('plaza.cannotView'),
        requirements
          ? t('plaza.restrictionMessage', { requirements })
          : t('plaza.profileBlockedGeneric', {
              defaultValue: '你暂不满足查看对方主页的条件',
            }),
      );
      return;
    }
    router.navigate(getUserProfileHref(scope, post.author.id));
  }, [post.canInteract, post.restrictions, post.author.id, router, scope, t]);

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

  // 左侧竖条按「我能不能报」上色:能报绿、已报主题紫、不满足条件橙。跟着本地的 signed 走,
  // 一报名立刻变紫。自己发的帖子也是主题紫(和「已报名」一样:这条和我有关)。
  const accentColor = isOwnPost || signed
    ? colors.tabBarActive
    : post.canSignup
      ? colors.success
      : colors.warning;

  return (
    <View style={d.card}>
      <View style={[s.accent, { backgroundColor: accentColor }]} testID="plaza-card-accent" />
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
        {!showInlineActions ? <Pressable
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
        </Pressable> : null}
      </View>

      {/* Body */}
      <Text style={d.body}>{post.content}</Text>

      {/* Tags */}
      {post.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {post.tags.map((tag) => (
            <Text key={tag} style={{ color: colors.iconAccent, ...Typography.caption }}>
              #{tag}
            </Text>
          ))}
        </View>
      ) : null}

      {/* Images */}
      <MomentMedia
        images={post.images}
        media={post.media}
        attachments={post.videos?.length ? [
          ...post.images.map((url) => ({ type: 'image' as const, key: url, url })),
          ...post.videos.map((url) => ({ type: 'video' as const, key: url, url })),
        ] : undefined}
      />

      {/* 底栏一行:左边报名条件(始终显示;绑定 signup-restriction 集,即后端 403 实际校验的那套,
          无门槛时显示"不限制"),右边自己的帖子显示报名人数(点进报名管理)、别人的帖子显示报名按钮。 */}
      <View style={s.footer} testID="plaza-card-footer">
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
        {showSignupAction && (isOwnPost ? (
          <Pressable
            onPress={handleManageSignups}
            hitSlop={6}
            style={[s.signupBtn, { borderColor: colors.surfaceBorder }]}
          >
            <Ionicons name="people-outline" size={16} color={colors.iconAccent} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.iconAccent }}>
              {t('plaza.manageSignups', {
                count: signupCount,
                defaultValue: '{{count}} 人报名',
              })}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            testID="plaza-card-signup"
            onPress={handleToggleSignup}
            disabled={busy}
            hitSlop={6}
            style={[
              s.signupBtn,
              // 和左侧竖条同一个颜色(accentColor):未报名 = 实心 CTA(能报绿、不满足条件橙并变淡);
              // 已报名 = 主题紫描边的确认态。
              signed
                ? { borderColor: accentColor, backgroundColor: 'transparent' }
                : {
                    borderColor: accentColor,
                    backgroundColor: accentColor,
                    opacity: post.canSignup ? 1 : 0.5,
                  },
            ]}
          >
            <Ionicons
              name={signed ? 'checkmark-circle' : 'person-add'}
              size={16}
              color={signed ? accentColor : colors.white}
            />
            <Text
              style={{
                fontSize: 13,
                fontWeight: '700',
                color: signed ? accentColor : colors.white,
              }}
            >
              {signed
                ? t('plaza.signedUp', { defaultValue: '已报名' })
                : t('plaza.signUp', { defaultValue: '报名' })}
              {signupCount > 0 ? ` ${signupCount}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {showInlineActions ? (
        <View style={[s.actionRow, { borderTopColor: colors.surfaceBorder }]}>
          {postActions.map((action) => {
            const color = action.destructive ? colors.error : colors.iconAccent;
            return (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                onPress={action.onPress}
                style={s.actionButton}
              >
                <Ionicons name={action.icon} size={18} color={color} />
                <Text style={{ color }}>{action.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <PlazaPostActionsSheet
          visible={menuVisible}
          actions={postActions}
          onClose={() => setMenuVisible(false)}
        />
      )}
    </View>
  );
};
