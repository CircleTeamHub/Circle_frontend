import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getApiErrorMessage } from '@/services/api/errors';
import { useLoginApproval } from '@/features/security/hooks/use-login-approval';
import { DialogOverlay } from '@/components/app/dialog-overlay';

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
  },
  card: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.h3, flex: 1 },
  detail: { ...Typography.bodyRegular, lineHeight: 20 },
  question: { ...Typography.body, fontWeight: '700' },
  warning: { ...Typography.small, lineHeight: 18 },
  code: {
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    paddingVertical: Spacing.sm,
  },
  error: { ...Typography.caption },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { ...Typography.body, fontWeight: '700' },
});

function formatTime(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(locale, { hour12: false });
}

/**
 * 受信任设备上的陌生设备登录批准弹窗。挂在根布局，登录态下常驻；
 * 有待处理请求且应用锁已解开时才出现。
 */
export function LoginApprovalHost() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const approval = useLoginApproval();
  const { stage, busy, codeSecondsLeft } = approval;

  const d = useMemo(
    () => ({
      card: { backgroundColor: colors.surface },
      title: { color: colors.text },
      detail: { color: colors.textSecondary },
      question: { color: colors.text },
      warning: { color: colors.error },
      code: { color: colors.primary },
      error: { color: colors.error },
      secondary: { backgroundColor: colors.surfaceBorder },
      secondaryText: { color: colors.text },
      primary: { backgroundColor: colors.primary },
      primaryText: { color: colors.white },
    }),
    [colors],
  );

  // 弹窗出现时收起键盘：iOS 的键盘在应用窗口之上，不收会挡住「是我 / 不是我」，
  // 而询问阶段没有别的关闭方式（还会把按键继续打进底下的输入框）。
  const prompting = stage !== null;
  useEffect(() => {
    if (prompting) Keyboard.dismiss();
  }, [prompting]);

  const goChangePassword = useCallback(() => {
    approval.close();
    router.push('/(tabs)/profile/change-password');
  }, [approval]);

  if (!stage) return null;

  const errorText = approval.error
    ? getApiErrorMessage(approval.error, t('loginApproval.failed'))
    : null;
  const button = (
    label: string,
    onPress: () => void,
    variant: 'primary' | 'secondary',
  ) => (
    <Pressable
      style={[s.action, variant === 'primary' ? d.primary : d.secondary]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy && variant === 'primary' ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text
          style={[
            s.actionText,
            variant === 'primary' ? d.primaryText : d.secondaryText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );

  let body: ReactNode;
  if (stage.kind === 'ask') {
    const { challenge } = stage;
    body = (
      <>
        <Text style={[s.detail, d.detail]}>
          {t('loginApproval.device', {
            value:
              challenge.deviceName ??
              t('settingsDetails.accountSecurity.deviceManagement.unknownDevice'),
          })}
        </Text>
        {challenge.ip ? (
          <Text style={[s.detail, d.detail]}>
            {t('loginApproval.ip', { value: challenge.ip })}
          </Text>
        ) : null}
        <Text style={[s.detail, d.detail]}>
          {t('loginApproval.time', {
            value: formatTime(challenge.createdAt, i18n.language),
          })}
        </Text>
        {challenge.recoveryAvailableAt ? (
          // 找回申请：不处理的话到点对方就能登录、并把这台设备退出 —— 必须讲清楚。
          <Text style={[s.warning, d.warning]}>
            {t('loginApproval.recoveryNotice', {
              value: formatTime(challenge.recoveryAvailableAt, i18n.language),
            })}
          </Text>
        ) : null}
        <Text style={[s.question, d.question]}>{t('loginApproval.question')}</Text>
        <Text style={[s.warning, d.warning]}>{t('loginApproval.warning')}</Text>
        {errorText ? <Text style={[s.error, d.error]}>{errorText}</Text> : null}
        <View style={s.actions}>
          {button(t('loginApproval.reject'), () => void approval.reject(), 'secondary')}
          {button(t('loginApproval.approve'), approval.approve, 'primary')}
        </View>
      </>
    );
  } else if (stage.kind === 'code') {
    const expired = codeSecondsLeft <= 0;
    body = (
      <>
        <Text style={[s.code, d.code]} selectable accessibilityLabel={stage.code.split('').join(' ')}>
          {expired ? '------' : stage.code}
        </Text>
        <Text style={[s.detail, d.detail]}>
          {expired
            ? t('loginApproval.codeExpired')
            : t('loginApproval.codeHint', { seconds: codeSecondsLeft })}
        </Text>
        <Text style={[s.warning, d.warning]}>{t('loginApproval.warning')}</Text>
        {errorText ? <Text style={[s.error, d.error]}>{errorText}</Text> : null}
        <View style={s.actions}>
          {expired
            ? button(t('loginApproval.regenerate'), approval.regenerate, 'primary')
            : button(t('loginApproval.done'), approval.close, 'primary')}
        </View>
      </>
    );
  } else {
    body = (
      <>
        <Text style={[s.detail, d.detail]}>{t('loginApproval.rejectedBody')}</Text>
        <View style={s.actions}>
          {button(t('loginApproval.later'), approval.close, 'secondary')}
          {button(t('loginApproval.changePassword'), goChangePassword, 'primary')}
        </View>
      </>
    );
  }

  const titleKey =
    stage.kind === 'ask'
      ? 'loginApproval.title'
      : stage.kind === 'code'
        ? 'loginApproval.codeTitle'
        : 'loginApproval.rejectedTitle';

  return (
    // 不用 RN Modal：iOS 上它从根 VC present，与应用锁的 Modal 同时弹会被 UIKit
    // 拒绝（应用锁可能因此出不来）。DialogOverlay 在 iOS 走 FullWindowOverlay。
    <DialogOverlay
      visible
      // 询问阶段必须明确选「是我 / 不是我」，返回键不关；其余阶段可直接关。
      onRequestClose={stage.kind === 'ask' ? () => undefined : approval.close}
    >
      <View style={s.overlay}>
        <View style={[s.card, d.card]} accessibilityViewIsModal>
          <View style={s.header}>
            <Ionicons name="shield-checkmark-outline" size={24} color={colors.primary} />
            <Text style={[s.title, d.title]}>{t(titleKey)}</Text>
          </View>
          {body}
        </View>
      </View>
    </DialogOverlay>
  );
}
