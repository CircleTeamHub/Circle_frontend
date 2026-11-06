import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';

// Proactive socket refresh has no screen-level error UI. Keep the cached session
// usable and offer the existing same-account login flow when recovery is needed.
export function SessionRecoveryPrompt() {
  const hydrated = useAuthStore(state => state.hasHydrated);
  const authenticated = useAuthStore(state => state.isAuthenticated);
  const uncertain = useAuthStore(state => state.refreshUncertain);
  const epoch = useAuthStore(state => state.sessionEpoch);
  const addingAccount = useAccountSwitcherStore(state => state.addingAccount);
  const switching = useAccountSwitcherStore(state => state.switching);
  const prompted = useRef<number | null>(null);
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    if (!hydrated || !authenticated || !uncertain) { prompted.current = null; return; }
    if (addingAccount || switching) { prompted.current = null; return; }
    if (prompted.current === epoch) return;
    prompted.current = epoch;
    Alert.alert(t('auth.login'), t('common.errors.refreshOutcomeUnknown'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.login'), onPress: () => {
        const auth = useAuthStore.getState();
        const accounts = useAccountSwitcherStore.getState();
        if (auth.sessionEpoch !== epoch || !auth.refreshUncertain || accounts.addingAccount || accounts.switching) return;
        accounts.setAddingAccount(true);
        router.push('/(auth)/login');
      } },
    ]);
  }, [hydrated, authenticated, uncertain, epoch, addingAccount, switching, router, t]);
  return null;
}
