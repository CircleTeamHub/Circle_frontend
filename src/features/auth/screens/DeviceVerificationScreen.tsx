import { usePreventRemove } from '@react-navigation/native';
import { useDeviceVerificationStore, type PendingDeviceVerification } from '@/features/auth/store/device-verification-store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuth } from '@/hooks/use-auth';
import {
  useDeviceVerification,
  type DeviceVerificationPhase,
} from '@/features/auth/hooks/use-device-verification';

const CODE_PATTERN = /^\d{6}$/;
const SECURITY_CODE_PATTERN = /^\d{4,6}$/;

const s = StyleSheet.create({
  container: { paddingHorizontal: Spacing.lg, gap: 20 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: Spacing.md,
  },
  intro: { ...Typography.bodyRegular, lineHeight: 22 },
  statusBox: { borderRadius: Radius.md, padding: Spacing.md },
  statusText: { ...Typography.caption, lineHeight: 20 },
  error: { ...Typography.caption },
  submitBtn: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' },
  link: { ...Typography.caption, textAlign: 'center', paddingVertical: Spacing.sm },
});

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * 陌生设备登录验证：等受信任设备批准，输入它显示的 6 位验证码后才登录。
 * 受信任设备不在身边且设置过登录安全码时，可改用安全码。
 */
export default function DeviceVerificationScreen() {
  const challenge = useDeviceVerificationStore((state) => state.challenge);
  const router = useRouter();
  useEffect(() => { if (!challenge) router.replace('/(auth)/login'); }, [challenge, router]);
  return challenge ? <DeviceVerificationContent challenge={challenge} /> : null;
}

function DeviceVerificationContent({ challenge }: { challenge: PendingDeviceVerification }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useEffect(() => () => {
    if (useDeviceVerificationStore.getState().challenge?.id === challenge.id) useDeviceVerificationStore.getState().setChallenge(null);
  }, [challenge.id]);
  const { completeVerifiedLogin, committing } = useAuth();
  usePreventRemove(Boolean(committing), () => {});
  const [code, setCode] = useState('');
  const [useSecurityCode, setUseSecurityCode] = useState(false);
  const securityCodeAvailable = challenge.securityCodeAvailable;

  const verification = useDeviceVerification({
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    onVerified: completeVerifiedLogin,
  });
  const { phase, remainingSeconds, submitting } = verification;
  const isTerminal = phase === 'rejected' || phase === 'expired';
  // 批准过但 60 秒的码已过期：重新发起会把请求退回受信任设备、再次弹窗确认。
  // 用安全码时不需要受信任设备，窗口内照样能输，所以只在验证码模式下切成重发。
  const needsResend =
    phase === 'expired' || (phase === 'codeExpired' && !useSecurityCode);
  const pattern = useSecurityCode ? SECURITY_CODE_PATTERN : CODE_PATTERN;
  const canSubmit = !submitting && !isTerminal && pattern.test(code.trim());

  const onSubmit = useCallback(() => {
    if (!canSubmit) return;
    if (useSecurityCode) void verification.submitSecurityCode(code);
    else void verification.submitCode(code);
  }, [canSubmit, code, useSecurityCode, verification]);

  const toggleMode = useCallback(() => {
    setUseSecurityCode((value) => !value);
    setCode('');
  }, []);

  const onResend = useCallback(() => {
    setCode('');
    void verification.resend();
  }, [verification]);

  const backToLogin = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(auth)/login');
  }, [router]);

  const statusText = useMemo(() => {
    const texts: Record<DeviceVerificationPhase, string> = {
      waiting: t('auth.deviceVerification.waiting', {
        time: formatCountdown(remainingSeconds),
      }),
      approved: t('auth.deviceVerification.approved', {
        seconds: remainingSeconds,
      }),
      codeExpired: t('auth.deviceVerification.approvedExpired'),
      rejected: t('auth.deviceVerification.rejected'),
      expired: t('auth.deviceVerification.expired'),
    };
    return useSecurityCode && !isTerminal
      ? t('auth.deviceVerification.securityCodeIntro')
      : texts[phase];
  }, [isTerminal, phase, remainingSeconds, t, useSecurityCode]);

  const d = useMemo(
    () => ({
      page: { flex: 1, backgroundColor: colors.background },
      iconWrap: { backgroundColor: colors.primaryLight },
      intro: { color: colors.textSecondary },
      statusBox: { backgroundColor: colors.surface },
      statusText: { color: phase === 'rejected' ? colors.error : colors.text },
      error: { color: colors.error },
      submit: { backgroundColor: colors.primary },
      submitDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
      link: { color: colors.primary },
    }),
    [colors, phase],
  );

  const errorText = verification.error
    ? getApiErrorMessage(verification.error, t('auth.deviceVerification.failed'))
    : null;

  return (
    <KeyboardAvoidingContainer style={[d.page, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('auth.deviceVerification.title')}
        fallbackHref="/(auth)/login"
      />
      <ScrollView
        contentContainerStyle={s.container}
        {...keyboardDismissOnDragProps}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.iconWrap, d.iconWrap]}>
          <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary} />
        </View>
        <Text style={[s.intro, d.intro]}>{t('auth.deviceVerification.intro')}</Text>
        <View style={[s.statusBox, d.statusBox]} accessibilityLiveRegion="polite">
          <Text style={[s.statusText, d.statusText]}>{statusText}</Text>
        </View>

        {isTerminal || (phase === 'codeExpired' && !useSecurityCode) ? null : (
          <AuthInput
            placeholder={
              useSecurityCode
                ? t('auth.deviceVerification.securityCodePlaceholder')
                : t('auth.deviceVerification.codePlaceholder')
            }
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            secureTextEntry={useSecurityCode}
            textContentType={useSecurityCode ? 'password' : 'oneTimeCode'}
            autoComplete={useSecurityCode ? 'off' : 'one-time-code'}
          />
        )}

        {errorText ? <Text style={[s.error, d.error]}>{errorText}</Text> : null}

        {phase === 'rejected' ? (
          <Pressable style={[s.submitBtn, d.submit]} onPress={backToLogin}>
            <Text style={[s.submitText, d.submitText]}>
              {t('auth.deviceVerification.backToLogin')}
            </Text>
          </Pressable>
        ) : needsResend ? (
          <Pressable
            style={[s.submitBtn, submitting ? d.submitDisabled : d.submit]}
            onPress={onResend}
            disabled={submitting}
          >
            <Text style={[s.submitText, d.submitText]}>
              {t('auth.deviceVerification.resend')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[s.submitBtn, canSubmit ? d.submit : d.submitDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            <Text style={[s.submitText, d.submitText]}>
              {submitting
                ? t('auth.deviceVerification.submitting')
                : t('auth.deviceVerification.submit')}
            </Text>
          </Pressable>
        )}

        {securityCodeAvailable && !isTerminal ? (
          <Pressable onPress={toggleMode} hitSlop={8}>
            <Text style={[s.link, d.link]}>
              {useSecurityCode
                ? t('auth.deviceVerification.useTrustedDevice')
                : t('auth.deviceVerification.useSecurityCode')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingContainer>
  );
}
