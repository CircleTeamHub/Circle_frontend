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
import { DeviceRecoverySection } from '@/features/auth/components/DeviceRecoverySection';
import { SecurityAnswerFields } from '@/features/auth/components/SecurityAnswerFields';
import { useLoginChallengeSecurityQuestions } from '@/features/auth/hooks/use-login-challenge-security-questions';

const CODE_PATTERN = /^\d{6}$/;
const SECURITY_CODE_PATTERN = /^\d{4,6}$/;

/** 受信任设备不在身边时的两种兜底：登录安全码、密保问题。 */
type VerificationMode = 'trustedDevice' | 'securityCode' | 'securityQuestions';

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

function formatDateTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * 陌生设备登录验证：等受信任设备批准，输入它显示的 6 位验证码后才登录。
 * 受信任设备不在身边时，设置过登录安全码 / 密保问题的账号可改用它们。
 */
export default function DeviceVerificationScreen() {
  const challenge = useDeviceVerificationStore((state) => state.challenge);
  const router = useRouter();
  useEffect(() => { if (!challenge) router.replace('/(auth)/login'); }, [challenge, router]);
  return challenge ? <DeviceVerificationContent challenge={challenge} /> : null;
}

function DeviceVerificationContent({ challenge }: { challenge: PendingDeviceVerification }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useEffect(() => () => {
    if (useDeviceVerificationStore.getState().challenge?.id === challenge.id) useDeviceVerificationStore.getState().setChallenge(null);
  }, [challenge.id]);
  const { completeVerifiedLogin, committing } = useAuth();
  usePreventRemove(Boolean(committing), () => {});
  const [code, setCode] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [mode, setMode] = useState<VerificationMode>('trustedDevice');
  const useSecurityCode = mode === 'securityCode';
  const useSecurityQuestions = mode === 'securityQuestions';
  const usingFallback = mode !== 'trustedDevice';
  const securityCodeAvailable = challenge.securityCodeAvailable;

  const verification = useDeviceVerification({
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    recoveryAvailableAt: challenge.recoveryAvailableAt,
    onVerified: completeVerifiedLogin,
  });
  // 按当前验证单查：重新发起后换了单，第一次没查到（如原单已过期）也能补上。
  const questionKeys = useLoginChallengeSecurityQuestions(verification.challengeId);
  const { phase, remainingSeconds, submitting } = verification;
  const isTerminal = phase === 'rejected' || phase === 'expired';
  const inRecoveryView = phase === 'recoveryWaiting' || phase === 'recoveryReady';
  // 批准过但 60 秒的码已过期：重新发起会把请求退回受信任设备、再次弹窗确认。
  // 用安全码 / 密保时不需要受信任设备，窗口内照样能输，所以只在验证码模式下切成重发。
  const needsResend =
    phase === 'expired' || (phase === 'codeExpired' && !usingFallback);
  const inputReady = useSecurityQuestions
    ? questionKeys.length > 0 &&
      questionKeys.every((_, index) => (answers[index] ?? '').trim() !== '')
    : (useSecurityCode ? SECURITY_CODE_PATTERN : CODE_PATTERN).test(code.trim());
  const canSubmit = !submitting && !isTerminal && inputReady;

  const onSubmit = useCallback(() => {
    if (!canSubmit) return;
    if (useSecurityQuestions) void verification.submitSecurityAnswers(answers);
    else if (useSecurityCode) void verification.submitSecurityCode(code);
    else void verification.submitCode(code);
  }, [answers, canSubmit, code, useSecurityCode, useSecurityQuestions, verification]);

  /** 再点一次同一个入口就退回受信任设备验证。 */
  const toggleMode = useCallback((target: Exclude<VerificationMode, 'trustedDevice'>) => {
    setMode((current) => (current === target ? 'trustedDevice' : target));
    setCode('');
    setAnswers([]);
  }, []);

  const onChangeAnswer = useCallback((index: number, answer: string) => {
    setAnswers((current) => {
      const next = [...current];
      next[index] = answer;
      return next;
    });
  }, []);

  const onResend = useCallback(() => {
    setCode('');
    void verification.resend();
  }, [verification]);

  const backToLogin = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(auth)/login');
  }, [router]);

  const onRequestRecovery = useCallback(() => {
    void verification.requestRecovery();
  }, [verification]);

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
      recoveryWaiting: t('auth.deviceVerification.recoveryWaiting', {
        time:
          verification.recoveryAvailableAt !== null
            ? formatDateTime(verification.recoveryAvailableAt, i18n.language)
            : '',
      }),
      recoveryReady: t('auth.deviceVerification.recoveryReady'),
    };
    if (!usingFallback || isTerminal || inRecoveryView) return texts[phase];
    return useSecurityCode
      ? t('auth.deviceVerification.securityCodeIntro')
      : t('auth.deviceVerification.securityQuestionsIntro');
  }, [
    i18n.language,
    inRecoveryView,
    isTerminal,
    phase,
    remainingSeconds,
    t,
    useSecurityCode,
    usingFallback,
    verification.recoveryAvailableAt,
  ]);

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

        {isTerminal ||
        inRecoveryView ||
        (phase === 'codeExpired' && !usingFallback) ? null : useSecurityQuestions ? (
          <SecurityAnswerFields
            questionKeys={questionKeys}
            answers={answers}
            onChangeAnswer={onChangeAnswer}
          />
        ) : (
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

        {inRecoveryView ? null : phase === 'rejected' ? (
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

        <DeviceRecoverySection
          phase={phase}
          requested={verification.recoveryAvailableAt !== null}
          submitting={submitting}
          onRequest={onRequestRecovery}
          onBackToLogin={backToLogin}
        />

        <View style={{ gap: Spacing.sm }}>
          <Text style={[s.intro, d.intro]}>{t('auth.deviceVerification.recoveryIntro')}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityState={{ disabled: submitting || committing }}
            disabled={submitting || committing}
            hitSlop={8}
            onPress={() => {
              if (!submitting && !committing) router.replace('/(auth)/forgot-password');
            }}
          >
            <Text style={d.link}>{t('auth.deviceVerification.recoverByEmail')}</Text>
          </Pressable>
        </View>

        {questionKeys.length > 0 && !isTerminal && !inRecoveryView ? (
          <Pressable onPress={() => toggleMode('securityQuestions')} hitSlop={8}>
            <Text style={[s.link, d.link]}>
              {useSecurityQuestions
                ? t('auth.deviceVerification.useTrustedDevice')
                : t('auth.deviceVerification.useSecurityQuestions')}
            </Text>
          </Pressable>
        ) : null}

        {securityCodeAvailable && !isTerminal && !inRecoveryView ? (
          <Pressable onPress={() => toggleMode('securityCode')} hitSlop={8}>
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
