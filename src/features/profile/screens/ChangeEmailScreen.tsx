import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { validateCode, validateEmail } from '@/features/auth/validation';
import { useCountdown } from '@/hooks/use-countdown';
import { changeEmail, requestEmailChange } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export default function ChangeEmailScreen() {
  const epoch = useAuthStore(state => state.sessionEpoch);
  return <ChangeEmailForm key={epoch} epoch={epoch} />;
}

function ChangeEmailForm({ epoch }: { epoch: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const countdown = useCountdown();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && useAuthStore.getState().sessionEpoch === epoch;

  async function submit(sendOnly: boolean) {
    if (inFlight.current || !isCurrent() || (sendOnly && countdown.running)) return;
    const invalidEmail = validateEmail(email);
    const currentEmail = useAuthStore.getState().user?.email?.trim().toLowerCase();
    const errorKey = invalidEmail ?? (!password ? 'settingsDetails.changeEmail.passwordRequired' : null)
      ?? (email.trim().toLowerCase() === currentEmail ? 'settingsDetails.changeEmail.sameEmail' : null)
      ?? (!sendOnly && validateCode(code) ? 'settingsDetails.changeEmail.invalidCode' : null);
    if (errorKey) { setError(t(errorKey)); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (sendOnly) {
        await requestEmailChange({ email, password });
        if (isCurrent()) countdown.start(60);
      } else {
        await changeEmail({ email, password, code });
        if (useAuthStore.getState().sessionEpoch !== epoch) return;
        await clearLocalSession(epoch, { reason: 'email-change', userInitiated: true });
        const latest = useAuthStore.getState();
        if (mounted.current && latest.sessionEpoch === epoch + 1 && !latest.user) router.replace('/(auth)/login');
      }
    } catch (failure) {
      if (isCurrent()) setError(getApiErrorMessage(failure, t(sendOnly ? 'settingsDetails.changeEmail.sendFailed' : 'settingsDetails.changeEmail.saveFailed')));
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingContainer style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <NavHeader title={t('settingsDetails.changeEmail.title')} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.lg }]} {...keyboardDismissOnDragProps} keyboardShouldPersistTaps="handled">
        <Text style={{ ...Typography.caption, color: colors.textSecondary }}>{t('settingsDetails.changeEmail.help')}</Text>
        <AuthInput placeholder={t('settingsDetails.changeEmail.newEmail')} value={email} editable={!busy} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" onChangeText={value => {
          if (inFlight.current) return;
          if (value.trim().toLowerCase() !== email.trim().toLowerCase()) {
            if (countdown.running) countdown.start(0);
            setCode('');
          }
          setEmail(value);
        }} />
        <AuthInput placeholder={t('settingsDetails.changeEmail.password')} value={password} onChangeText={setPassword} editable={!busy} secureTextEntry textContentType="password" autoComplete="current-password" />
        <AuthInput placeholder={t('settingsDetails.changeEmail.code')} value={code} onChangeText={setCode} editable={!busy} keyboardType="number-pad" textContentType="oneTimeCode" rightElement={
          <Pressable accessibilityRole="button" hitSlop={12} disabled={busy || countdown.running} onPress={() => void submit(true)}>
            <Text style={{ color: busy || countdown.running ? colors.textSecondary : colors.primary }}>{t(countdown.running ? 'settingsDetails.changeEmail.sendAgain' : 'settingsDetails.changeEmail.sendCode', { seconds: countdown.seconds })}</Text>
          </Pressable>
        } />
        {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit(false)} style={[s.button, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
          <Text style={{ ...Typography.body, color: colors.white }}>{t('settingsDetails.changeEmail.submit')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingContainer>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  button: { minHeight: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
});
