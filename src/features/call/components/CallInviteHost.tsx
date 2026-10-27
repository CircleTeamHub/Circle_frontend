import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Radius, Spacing, Typography } from '@/theme';
import { useCallStore } from '@/features/call/store/use-call-store';
import { useIncomingCallExpiry } from '@/features/call/hooks/use-incoming-call-expiry';
import { useCallReconciliation } from '@/features/call/hooks/use-call-reconciliation';
import '@/features/call/call-session-teardown';
import { nativeOwnsIncomingCallUi } from '@/features/call/push/call-push-native';
import {
  answerIncomingCall,
  declineIncomingCall,
} from '@/features/call/push/incoming-call-actions';
import { useCallPushBridge } from '@/features/call/push/use-call-push-bridge';
import { useRingingCallWatchdog } from '@/features/call/push/use-ringing-call-watchdog';

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  sheet: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconShell: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    ...Typography.body,
    fontWeight: '700',
  },
  subtitle: {
    ...Typography.small,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  action: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  actionText: {
    ...Typography.body,
    fontWeight: '700',
  },
});

export function CallInviteHost() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // 回前台时与服务端对账（#93）：清掉断线期间已在服务端结束的本地通话残留。
  useCallReconciliation();
  // 推送来电：原生事件（CallKit / 全屏通知上的接听、拒接）↔ store。
  useCallPushBridge();
  useRingingCallWatchdog();
  const incomingCall = useCallStore((state) => state.incomingCall);
  const resetCallState = useCallStore((state) => state.resetCallState);
  const [busyAction, setBusyAction] = useState<'accept' | 'reject' | null>(null);
  // iOS 打过新原生包后来电一律走 CallKit 的系统界面，这里不再叠一层弹窗。
  const visible = Boolean(incomingCall) && !nativeOwnsIncomingCallUi();
  // review P1：VIDEO 邀请必须如实标示 —— 接听即发布摄像头，套着语音来电的
  // 皮会让用户在不知情下开摄像头。
  const isVideoInvite = incomingCall?.callType === 'VIDEO';

  const handleAccept = useCallback(async () => {
    if (!incomingCall || busyAction) return;
    setBusyAction('accept');
    try {
      await answerIncomingCall(incomingCall.callId);
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, incomingCall]);

  const handleReject = useCallback(async () => {
    if (!incomingCall || busyAction) return;
    setBusyAction('reject');
    try {
      await declineIncomingCall(incomingCall.callId);
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, incomingCall]);

  // 安全网：来电到 expiresAt 仍未接听 / 拒绝时自动清除，避免丢失的终止推送把
  // 全屏来电弹窗永久卡住。
  useIncomingCallExpiry(incomingCall, resetCallState);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleReject}
    >
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.surface }]}>
          <View style={s.row}>
            <View style={[s.iconShell, { backgroundColor: colors.primaryLight }]}>
              <Ionicons
                name={isVideoInvite ? 'videocam' : 'call'}
                size={24}
                color={colors.iconAccent}
              />
            </View>
            <View style={s.copy}>
              {/* round 3 review：1:1 邀请（sessionType='single'）不能顶着
                  「发起群语音 / N 人被邀请」的文案 —— 按会话类型分支。 */}
              <Text style={[s.title, { color: colors.text }]}>
                {incomingCall?.sessionType === 'single'
                  ? t(
                      isVideoInvite
                        ? 'call.invite.initiatedBySingleVideo'
                        : 'call.invite.initiatedBySingle',
                      {
                        defaultValue: isVideoInvite
                          ? '{{name}} 邀请你视频通话'
                          : '{{name}} 邀请你语音通话',
                        name:
                          incomingCall?.initiator.nickname ??
                          t('call.invite.friend', { defaultValue: '好友' }),
                      },
                    )
                  : t(
                      isVideoInvite
                        ? 'call.invite.initiatedByVideo'
                        : 'call.invite.initiatedBy',
                      {
                        defaultValue: isVideoInvite
                          ? '{{name}} 发起群视频'
                          : '{{name}} 发起群语音',
                        name:
                          incomingCall?.initiator.nickname ??
                          t('call.invite.groupMember', { defaultValue: '群成员' }),
                      },
                    )}
              </Text>
              <Text style={[s.subtitle, { color: colors.textSecondary }]}>
                {incomingCall?.sessionType === 'single'
                  ? isVideoInvite
                    ? t('call.typeVideo', { defaultValue: '视频通话' })
                    : t('call.invite.singleSubtitle', {
                        defaultValue: '语音通话',
                      })
                  : t('call.invite.inviteeCount', {
                      defaultValue: '{{count}} 人被邀请',
                      count: incomingCall?.invitees.length ?? 0,
                    })}
              </Text>
            </View>
          </View>

          <View style={s.actions}>
            <Pressable
              style={[s.action, { backgroundColor: colors.surfaceBorder }]}
              onPress={handleReject}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'reject' ? (
                <ActivityIndicator color={colors.textSecondary} />
              ) : (
                <>
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                  <Text style={[s.actionText, { color: colors.textSecondary }]}>
                    {t('call.reject', { defaultValue: '拒绝' })}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[s.action, { backgroundColor: colors.primary }]}
              onPress={handleAccept}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'accept' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons
                    name={isVideoInvite ? 'videocam' : 'call'}
                    size={18}
                    color={colors.white}
                  />
                  <Text style={[s.actionText, { color: colors.white }]}>
                    {t('call.accept', { defaultValue: '接听' })}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
