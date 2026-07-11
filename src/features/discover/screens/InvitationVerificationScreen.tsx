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

const TOTAL_SLOTS = 10;

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

  const filledSlots: (CircleInvitationVerifier | null)[] = invitation
    ? [
        ...invitation.verifiers,
        ...Array(Math.max(0, TOTAL_SLOTS - invitation.verifiers.length)).fill(
          null,
        ),
      ].slice(0, TOTAL_SLOTS)
    : [];

  const canAddMore = Boolean(
    invitation &&
      invitation.status === 'PENDING' &&
      invitation.verifiers.filter((v) => v.status !== 'REJECTED').length <
        TOTAL_SLOTS,
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
          {t('invitation.requireVerifiers', { count: TOTAL_SLOTS })}
        </Text>

        <View style={s.progressRow}>
          <Text style={[s.progressText, d.progressText]}>
            {t('invitation.progress', { approved: invitation.approvedCount, total: TOTAL_SLOTS })}
          </Text>
        </View>

        {/* 10 slot grid */}
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
