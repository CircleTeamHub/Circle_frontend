import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Radius, Spacing, Typography } from '@/theme';
import { acceptCall, rejectCall } from '@/services/api/calls';
import { useCallStore } from '@/features/call/store/use-call-store';

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
  const incomingCall = useCallStore((state) => state.incomingCall);
  const setActiveCall = useCallStore((state) => state.setActiveCall);
  const resetCallState = useCallStore((state) => state.resetCallState);
  const [busyAction, setBusyAction] = useState<'accept' | 'reject' | null>(null);
  const visible = Boolean(incomingCall);

  const handleAccept = useCallback(async () => {
    if (!incomingCall || busyAction) return;
    setBusyAction('accept');
    try {
      const response = await acceptCall(incomingCall.callId);
      setActiveCall(response.call, response.livekit);
      router.push('/(chat)/group-call' as never);
    } catch (error) {
      resetCallState();
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] accept failed', error);
      }
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, incomingCall, resetCallState, setActiveCall]);

  const handleReject = useCallback(async () => {
    if (!incomingCall || busyAction) return;
    setBusyAction('reject');
    try {
      await rejectCall(incomingCall.callId);
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] reject failed', error);
      }
    } finally {
      resetCallState();
      setBusyAction(null);
    }
  }, [busyAction, incomingCall, resetCallState]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.surface }]}>
          <View style={s.row}>
            <View style={[s.iconShell, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="call" size={24} color={colors.primary} />
            </View>
            <View style={s.copy}>
              <Text style={[s.title, { color: colors.text }]}>
                {incomingCall?.initiator.nickname ?? '群成员'} 发起群语音
              </Text>
              <Text style={[s.subtitle, { color: colors.textSecondary }]}>
                {incomingCall?.invitees.length ?? 0} 人被邀请
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
                  <Text style={[s.actionText, { color: colors.textSecondary }]}>拒绝</Text>
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
                  <Ionicons name="call" size={18} color={colors.white} />
                  <Text style={[s.actionText, { color: colors.white }]}>接听</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
