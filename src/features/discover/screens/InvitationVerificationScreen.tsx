import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getCircleScopeFromSegments,
  getSelectVerifierHref,
} from '@/features/user/utils/routes';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchInvitation } from '@/services/api/circles';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import type { CircleInvitation, CircleInvitationVerifier } from '@/types';

// 席位数是每张担保单自己的快照(建单那一刻圈子的 requiredVerifierCount),
// 不是常量:圈子把验证人数调成 2 / 5 之后,写死 10 会让申请人被告知「需要
// 十位好友验证」,进度条分母也是错的,还会在满席之后继续给「添加验证人」。
const MIN_SLOTS = 1;

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.lg,
  },
  progressText: {
    ...Typography.h2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  slot: {
    width: 60,
    height: 76,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  slotCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotLabel: {
    ...Typography.tinyRegular,
    textAlign: 'center',
  },
  statusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    marginTop: Spacing.xl,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    ...Typography.body,
    fontWeight: '600',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    ...Typography.caption,
    textAlign: 'center',
  },
});

export default function InvitationVerificationScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  // 本页镜像在 messages/discover 两栈，子页跳转留在当前栈。
  const segments = useSegments();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invitation, setInvitation] = useState<CircleInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadInvitation = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      const data = await fetchInvitation(id);
      setInvitation(data);
    } catch (error) {
      // 之前是 Alert + setInvitation(null) 渲染 "不存在" —— 把临时网络错误误判成 404。
      // 改成 loadError + 重试按钮，跟 MomentDetailScreen 对齐。
      setLoadError(
        t('invitation.loadFailed', { defaultValue: '加载失败，请稍后重试' }),
      );
      if (__DEV__) {
        console.warn('[InvitationVerificationScreen] fetchInvitation failed', error);
      }
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadInvitation();
  }, [loadInvitation]);

  useEffect(() => {
    void markMatchingTargetNotificationsRead({ invitationId: id });
  }, [id]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      progressText: { color: colors.primary },
      subtitle: { color: colors.textSecondary },
      slotCircle: { borderColor: colors.surfaceBorder },
      slotLabel: { color: colors.textSecondary },
      addButton: { backgroundColor: colors.primary },
      addButtonText: { color: colors.white },
    }),
    [colors],
  );

  const totalSlots = Math.max(MIN_SLOTS, invitation?.requiredCount ?? MIN_SLOTS);

  // 被拒的席位会腾出来给别人(服务端的 activeSlots 同样不计 REJECTED),所以
  // 空位按「还差多少个在用的席位」补,而不是按 totalSlots 减总行数 —— 否则
  // 一旦有人拒过,「可以再加人」与「没有空位可点」就会同时成立。
  // 网格只画「还在数的席位」:已拒绝的行留在里面的话,每拒一次网格就多一格,
  // 而这是个不可滚动的 View —— 几轮拒绝/补位之后,「添加验证人」那一格会被顶
  // 出屏幕,申请人再也点不到,等于把自己锁死。被拒的历史另行成句提示。
  const activeVerifiers = invitation
    ? invitation.verifiers.filter((v) => v.status !== 'REJECTED')
    : [];
  const activeVerifierCount = activeVerifiers.length;
  const rejectedCount = invitation
    ? invitation.verifiers.length - activeVerifierCount
    : 0;

  const filledSlots: (CircleInvitationVerifier | null)[] = invitation
    ? [
        ...activeVerifiers,
        ...Array(Math.max(0, totalSlots - activeVerifierCount)).fill(null),
      ]
    : [];

  const canAddMore = Boolean(
    invitation &&
      invitation.status === 'PENDING' &&
      activeVerifierCount < totalSlots,
  );

  const handleAddVerifier = useCallback(() => {
    if (!invitation) return;
    router.push(
      getSelectVerifierHref(getCircleScopeFromSegments(segments), {
        id: invitation.id,
        circleId: invitation.circleId,
        circleName: invitation.circleName,
      }),
    );
  }, [router, invitation, segments]);

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('invitation.title')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!invitation) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('invitation.title')} />
        <View style={s.centerLoader}>
          <Text style={d.subtitle}>
            {loadError ?? t('invitation.notExist')}
          </Text>
          {loadError ? (
            <Pressable
              onPress={loadInvitation}
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

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('invitation.joinTitle', { name: invitation.circleName })} />
      <View style={s.content}>
        <Text style={[s.subtitle, d.subtitle]}>
          {t('invitation.requireVerifiers', { count: totalSlots })}
        </Text>

        <View style={s.progressRow}>
          <Text style={[s.progressText, d.progressText]}>
            {t('invitation.progress', {
              approved: invitation.approvedCount,
              total: totalSlots,
            })}
          </Text>
        </View>

        {rejectedCount > 0 ? (
          <Text style={[s.subtitle, d.subtitle]}>
            {t('invitation.rejectedCount', { count: rejectedCount })}
          </Text>
        ) : null}

        {/* 席位格子:数量来自这张单子的 requiredCount 快照 */}
        <View style={s.grid}>
          {filledSlots.map((slot, i) => {
            if (!slot) {
              // Empty slot
              return (
                <Pressable
                  key={`empty-${i}`}
                  style={s.slot}
                  onPress={canAddMore ? handleAddVerifier : undefined}
                >
                  <View style={[s.slotCircle, d.slotCircle]}>
                    {canAddMore ? (
                      <Ionicons name="add" size={22} color={colors.textSecondary} />
                    ) : null}
                  </View>
                  <Text style={[s.slotLabel, d.slotLabel]}>
                    {canAddMore ? t('invitation.addSlot') : t('invitation.emptySlot')}
                  </Text>
                </Pressable>
              );
            }

            // Filled slot
            const statusIcon: {
              name: keyof typeof Ionicons.glyphMap;
              color: string;
            } =
              slot.status === 'APPROVED'
                ? { name: 'checkmark-circle', color: '#22C55E' }
                : slot.status === 'REJECTED'
                  ? { name: 'close-circle', color: colors.error }
                  : { name: 'time', color: colors.warning };

            return (
              <View key={slot.id} style={s.slot}>
                <View>
                  <Avatar
                    size={52}
                    name={slot.verifier.nickname}
                    uri={slot.verifier.avatarUrl ?? undefined}
                  />
                  <View
                    style={[
                      s.statusBadge,
                      { backgroundColor: colors.background },
                    ]}
                  >
                    <Ionicons
                      name={statusIcon.name}
                      size={16}
                      color={statusIcon.color}
                    />
                  </View>
                </View>
                <Text
                  style={[s.slotLabel, d.slotLabel]}
                  numberOfLines={1}
                >
                  {slot.verifier.nickname}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Add verifier button */}
        {canAddMore ? (
          <Pressable
            style={[s.addButton, d.addButton]}
            onPress={handleAddVerifier}
          >
            <Text style={[s.addButtonText, d.addButtonText]}>
              {t('invitation.inviteFriends')}
            </Text>
          </Pressable>
        ) : null}

        {invitation.status === 'APPROVED' || invitation.status === 'ADMIN_APPROVED' ? (
          <View style={[s.progressRow, { marginTop: Spacing.xl }]}>
            <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
            <Text style={{ color: '#22C55E', ...Typography.body, fontWeight: '600' }}>
              {t('invitation.verified')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
