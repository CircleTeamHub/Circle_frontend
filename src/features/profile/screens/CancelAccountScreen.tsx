import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { deleteAccount } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export default function CancelAccountScreen() {
  const epoch = useAuthStore(state => state.sessionEpoch);
  return <CancelAccountForm key={epoch} epoch={epoch} />;
}

function CancelAccountForm({ epoch }: { epoch: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(state => state.user);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirming = useRef(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && useAuthStore.getState().sessionEpoch === epoch;
  const matches = !!user?.accountId && confirmation.trim() === user.accountId;

  async function removeAccount() {
    if (inFlight.current || !isCurrent() || !user || !matches) return;
    inFlight.current = true;
    setError(null);
    try {
      await deleteAccount(user.id);
      if (useAuthStore.getState().sessionEpoch !== epoch) return;
      await clearLocalSession(epoch, { reason: 'account-cancel', userInitiated: true });
      const latest = useAuthStore.getState();
      if (mounted.current && latest.sessionEpoch === epoch + 1 && !latest.user) router.replace('/(auth)/login');
    } catch (failure) {
      if (isCurrent()) setError(getApiErrorMessage(failure, t('settingsDetails.cancelAccount.failed')));
    } finally {
      inFlight.current = false;
      confirming.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  function confirm() {
    if (!matches || confirming.current || !isCurrent()) return;
    confirming.current = true;
    setBusy(true);
    Alert.alert(t('settingsDetails.cancelAccount.title'), t('settingsDetails.cancelAccount.warning'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => { confirming.current = false; if (isCurrent()) setBusy(false); } },
      { text: t('settingsDetails.cancelAccount.action'), style: 'destructive', onPress: () => void removeAccount() },
    ], { cancelable: false });
  }

  return (
    <KeyboardAvoidingContainer style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <NavHeader title={t('settingsDetails.cancelAccount.title')} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.lg }]} {...keyboardDismissOnDragProps} keyboardShouldPersistTaps="handled">
        <Text style={{ ...Typography.body, color: colors.error }}>{t('settingsDetails.cancelAccount.warning')}</Text>
        <Text style={{ ...Typography.body, color: colors.text }}>{t('profileFields.accountId')}: {user?.accountId}</Text>
        <AuthInput placeholder={t('settingsDetails.cancelAccount.confirmation')} value={confirmation} onChangeText={setConfirmation} editable={!busy} />
        {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy || !matches} onPress={confirm} style={[s.button, { backgroundColor: colors.error, opacity: busy || !matches ? 0.6 : 1 }]}>
          <Text style={{ ...Typography.body, color: colors.white }}>{t('settingsDetails.cancelAccount.action')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingContainer>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  button: { minHeight: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
});
