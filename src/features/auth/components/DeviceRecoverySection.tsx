import { useCallback, useMemo } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import type { DeviceVerificationPhase } from '@/features/auth/hooks/use-device-verification';

const s = StyleSheet.create({
  submitBtn: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' },
  link: { ...Typography.caption, textAlign: 'center', paddingVertical: Spacing.sm },
});

interface DeviceRecoverySectionProps {
  phase: DeviceVerificationPhase;
  /** 已经申请过找回（有可完成时间）。 */
  requested: boolean;
  submitting: boolean;
  onRequest: () => void;
  onBackToLogin: () => void;
}

/** 哪些状态下可以申请找回：还在等批准 / 批准过但码过期。 */
export function canRequestRecovery(
  phase: DeviceVerificationPhase,
  requested: boolean,
): boolean {
  // 网页端每次刷新都换设备 ID，做不到「等待期后在同一台设备上完成」，不提供。
  if (Platform.OS === 'web' || requested) return false;
  return phase === 'waiting' || phase === 'codeExpired';
}

/**
 * 新设备验证页上的「找回」：受信任设备全都用不了（原来的手机丢了 / 重装 / 恢复出厂）时，
 * 申请等待期后在这台设备上登录。申请前确认一次，讲清楚等待期和会退出其他设备。
 */
export function DeviceRecoverySection({
  phase,
  requested,
  submitting,
  onRequest,
  onBackToLogin,
}: DeviceRecoverySectionProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const d = useMemo(
    () => ({
      primary: { backgroundColor: colors.primary },
      disabled: { backgroundColor: colors.surfaceBorder },
      primaryText: { color: colors.white },
      link: { color: colors.primary },
    }),
    [colors],
  );

  const confirmRequest = useCallback(() => {
    Alert.alert(
      t('auth.deviceVerification.recoveryConfirmTitle'),
      t('auth.deviceVerification.recoveryConfirmBody'),
      [
        { text: t('auth.deviceVerification.recoveryCancel'), style: 'cancel' },
        {
          text: t('auth.deviceVerification.recoveryConfirm'),
          onPress: onRequest,
        },
      ],
    );
  }, [onRequest, t]);

  if (phase === 'recoveryWaiting' || phase === 'recoveryReady') {
    const ready = phase === 'recoveryReady';
    return (
      <Pressable
        style={[s.submitBtn, d.primary]}
        onPress={onBackToLogin}
        accessibilityRole="button"
      >
        <Text style={[s.submitText, d.primaryText]}>
          {ready
            ? t('auth.deviceVerification.recoveryGoLogin')
            : t('auth.deviceVerification.recoveryUnderstood')}
        </Text>
      </Pressable>
    );
  }

  if (!canRequestRecovery(phase, requested)) return null;
  return (
    <Pressable
      onPress={confirmRequest}
      disabled={submitting}
      hitSlop={8}
      accessibilityRole="button"
    >
      <Text style={[s.link, d.link]}>
        {t('auth.deviceVerification.recoveryEntry')}
      </Text>
    </Pressable>
  );
}
