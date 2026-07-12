import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchInvitation, respondToVerification } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import type { CircleInvitation } from '@/types';

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    paddingTop: Spacing.xl,
  },
  card: {
    width: '100%',
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  nameText: {
    ...Typography.h2,
  },
  descText: {
    ...Typography.body,
    textAlign: 'center',
  },
  progressText: {
    ...Typography.caption,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    ...Typography.body,
    fontWeight: '600',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  progressBlock: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  footer: {
    width: '100%',
    marginTop: 'auto',
    paddingBottom: Spacing.lg,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
  },
});

export default function VerificationRequestScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invitation, setInvitation] = useState<CircleInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [responded, setResponded] = useState(false);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadInvitation = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    // mountedRef + requestRef 双重护栏：卸载或被新一轮加载抢占时不再 setState。
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchInvitation(id);
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setInvitation(data);
    } catch (error) {
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setLoadError(
        t('invitation.loadFailed', { defaultValue: '加载失败，请稍后重试' }),
      );
      if (__DEV__) {
        console.warn('[VerificationRequestScreen] fetchInvitation failed', error);
      }
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        setLoading(false);
      }
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
      card: { backgroundColor: colors.surface },
      nameText: { color: colors.text },
      descText: { color: colors.textSecondary },
      progressText: { color: colors.primary },
      approveBtn: { backgroundColor: colors.primary },
      rejectBtn: { backgroundColor: colors.surfaceBorder },
      approveBtnText: { color: colors.white },
      rejectBtnText: { color: colors.text },
    }),
    [colors],
  );

  const handleRespond = useCallback(
    async (approve: boolean) => {
      if (!id || responding) return;
      setResponding(true);
      try {
        await respondToVerification(id, approve);
        if (!mountedRef.current) return;
        setResponded(true);
        Alert.alert(approve ? t('invitation.approved') : t('invitation.rejected'), undefined, [
          { text: t('common.confirm'), onPress: () => router.back() },
        ]);
      } catch (error: unknown) {
        if (!mountedRef.current) return;
        Alert.alert(
          t('common.errorOccurred'),
          getApiErrorMessage(error, t('common.errorOccurred')),
        );
      } finally {
        if (mountedRef.current) setResponding(false);
      }
    },
    [id, responding, router, t],
  );

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('invitation.verificationRequest')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!invitation) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('invitation.verificationRequest')} />
        <View style={s.centerLoader}>
          <Text style={d.descText}>
            {loadError ?? t('invitation.requestNotExist')}
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

  // 角色判定：申请人本人只能看进度（等待验证）；只有被邀请的验证人才有同意/拒绝；
  // 已响应或申请已结束则显示对应状态文案，而不是再给一次操作按钮。
  // 身份可能尚未水合（冷启动深链直达此页时 authStore.user 还没填充）。此时所有
  // 「我是谁」的判定都不可信，必须先按未就绪处理，否则会把合法验证人误判成旁观者。
  const identityReady = currentUserId != null;
  const isApplicant = invitation.applicant.id === currentUserId;
  const myVerifier = invitation.verifiers.find(
    (v) => v.verifier.id === currentUserId,
  );
  const settled = invitation.status !== 'PENDING';
  const myResponded =
    responded || (myVerifier != null && myVerifier.status !== 'PENDING');
  const canRespond = !settled && myVerifier?.status === 'PENDING' && !responded;
  const ratio =
    invitation.requiredCount > 0
      ? Math.min(1, invitation.approvedCount / invitation.requiredCount)
      : 0;

  const GREEN = '#22C55E';
  const RED = '#EF4444';

  const renderFooter = () => {
    if (canRespond) {
      return (
        <View style={s.buttonRow}>
          <Pressable
            style={[s.btn, d.rejectBtn]}
            onPress={() => handleRespond(false)}
            disabled={responding}
          >
            <Text style={[s.btnText, d.rejectBtnText]}>
              {t('invitation.reject')}
            </Text>
          </Pressable>
          <Pressable
            style={[s.btn, d.approveBtn]}
            onPress={() => handleRespond(true)}
            disabled={responding}
          >
            {responding ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[s.btnText, d.approveBtnText]}>
                {t('invitation.approve')}
              </Text>
            )}
          </Pressable>
        </View>
      );
    }

    // 申请仍在进行、但当前用户身份还没水合：先给中性 loading，避免误判为旁观者。
    // 已结束的申请（settled）与身份无关，可直接落到下面的结果文案。
    if (!identityReady && !settled && !myResponded) {
      return (
        <View style={[s.statusPill, { backgroundColor: colors.surface }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    let icon: keyof typeof Ionicons.glyphMap = 'time-outline';
    let tone = colors.textSecondary;
    let label = '';
    if (settled && invitation.status === 'REJECTED') {
      icon = 'close-circle';
      tone = RED;
      label = t('invitation.settledRejected', { defaultValue: '该申请已被拒绝' });
    } else if (settled) {
      icon = 'checkmark-circle';
      tone = GREEN;
      label = t('invitation.settledApproved', {
        defaultValue: '该申请已通过，已加入圈子',
      });
    } else if (myResponded) {
      const rejected = myVerifier?.status === 'REJECTED';
      icon = rejected ? 'close-circle' : 'checkmark-circle';
      tone = rejected ? RED : GREEN;
      label = rejected
        ? t('invitation.youRejected', { defaultValue: '你已拒绝该申请' })
        : t('invitation.youApproved', { defaultValue: '你已帮 TA 验证' });
    } else if (isApplicant) {
      icon = 'time-outline';
      tone = colors.primary;
      label = t('invitation.waitingDesc', {
        approved: invitation.approvedCount,
        total: invitation.requiredCount,
        defaultValue:
          '正在等待好友验证（{{approved}}/{{total}}），满 {{total}} 人即可加入',
      });
    } else {
      icon = 'eye-outline';
      tone = colors.textSecondary;
      label = t('invitation.viewerOnly', {
        defaultValue: '你不是该申请的验证人',
      });
    }

    return (
      <View style={[s.statusPill, { backgroundColor: colors.surface }]}>
        <Ionicons name={icon} size={20} color={tone} />
        <Text style={{ color: tone, ...Typography.body }}>{label}</Text>
      </View>
    );
  };

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('invitation.verificationRequest')} />
      <View style={s.content}>
        <View style={[s.card, d.card]}>
          <Avatar
            size={64}
            name={invitation.applicant.nickname}
            uri={invitation.applicant.avatarUrl ?? undefined}
          />
          <Text style={[s.nameText, d.nameText]}>
            {invitation.applicant.nickname}
          </Text>
          <Text style={[s.descText, d.descText]}>
            {t('invitation.wantsToJoin', { circle: invitation.circleName })}
          </Text>
          <Text style={[s.descText, d.descText]}>
            {t('invitation.invitedBy', { name: invitation.inviter.nickname })}
          </Text>
          <View style={s.progressBlock}>
            <View
              style={[s.progressTrack, { backgroundColor: colors.surfaceBorder }]}
            >
              <View
                style={[
                  s.progressFill,
                  {
                    width: `${Math.round(ratio * 100)}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={[s.progressText, d.progressText]}>
              {t('invitation.verifyProgress', {
                approved: invitation.approvedCount,
                total: invitation.requiredCount,
              })}
            </Text>
          </View>
        </View>

        <View style={s.footer}>{renderFooter()}</View>
      </View>
    </View>
  );
}
