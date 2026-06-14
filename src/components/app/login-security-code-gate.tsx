import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import {
  fetchLoginSecurityCodeStatus,
  verifyLoginSecurityCode,
} from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type GateState = 'checking' | 'locked' | 'verifying' | 'unlocked';

const SECURITY_CODE_PATTERN = /^\d{4,6}$/;

const s = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
  },
  panel: {
    gap: Spacing.lg,
  },
  titleBlock: {
    gap: Spacing.sm,
  },
  title: {
    ...Typography.title,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {
    gap: Spacing.md,
  },
  error: {
    ...Typography.caption,
    textAlign: 'center',
  },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  textButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function LoginSecurityCodeGate() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [gateState, setGateState] = useState<GateState>('unlocked');
  const [securityCode, setSecurityCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const securityCodeEnabledRef = useRef(false);

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + Spacing.xl,
      },
      title: {
        color: colors.text,
      },
      subtitle: {
        color: colors.textSecondary,
      },
      error: {
        color: colors.error,
      },
      button: {
        backgroundColor: colors.primary,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      textButton: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  const refreshSecurityCodeStatus = useCallback(async () => {
    if (!isAuthenticated || isLoading) {
      securityCodeEnabledRef.current = false;
      setSecurityCode('');
      setError(null);
      setGateState('unlocked');
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSecurityCode('');
    setError(null);
    setGateState(securityCodeEnabledRef.current ? 'locked' : 'unlocked');

    try {
      const status = await fetchLoginSecurityCodeStatus();
      if (requestIdRef.current !== requestId) return;
      securityCodeEnabledRef.current = status.enabled;
      setGateState(status.enabled ? 'locked' : 'unlocked');
    } catch (requestError) {
      if (requestIdRef.current !== requestId) return;
      // 状态拉取失败时保留上一次已知状态，避免把「拿不到状态」误判为「未开启」、
      // 从而把已开启安全码的账号静默放行。已知已开启 -> 保持锁定（fail-closed），
      // 未知/未开启 -> 维持解锁，避免后端抖动时把所有人挡在门外。
      setGateState(securityCodeEnabledRef.current ? 'locked' : 'unlocked');
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[security-code] status check failed', requestError);
      }
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    void refreshSecurityCodeStatus();
  }, [refreshSecurityCodeStatus, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        if (
          useAuthStore.getState().isAuthenticated &&
          securityCodeEnabledRef.current
        ) {
          setGateState('locked');
        }
        return;
      }

      void refreshSecurityCodeStatus();
    });

    return () => {
      subscription.remove();
    };
  }, [refreshSecurityCodeStatus]);

  async function handleUnlock() {
    if (gateState === 'verifying') return;

    setError(null);
    if (!SECURITY_CODE_PATTERN.test(securityCode)) {
      setError(t('profile.securityCodeInvalid'));
      return;
    }

    setGateState('verifying');
    try {
      const result = await verifyLoginSecurityCode(securityCode);
      if (result.ok) {
        setSecurityCode('');
        setGateState('unlocked');
        return;
      }

      setGateState('locked');
      setSecurityCode('');
      setError(t('profile.securityCodeVerifyFailed'));
    } catch (requestError) {
      setGateState('locked');
      setSecurityCode('');
      setError(
        getApiErrorMessage(requestError, t('profile.securityCodeVerifyFailed')),
      );
    }
  }

  async function handleLogout() {
    await clearLocalSession();
    setGateState('unlocked');
    setSecurityCode('');
    router.replace('/(auth)/login');
  }

  const visible =
    isAuthenticated &&
    !isLoading &&
    (gateState === 'locked' || gateState === 'verifying');

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen">
      <KeyboardAvoidingView
        style={[s.container, d.container]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.panel}>
          <View style={s.titleBlock}>
            <Text style={[s.title, d.title]}>{t('profile.unlockSecurityCode')}</Text>
            <Text style={[s.subtitle, d.subtitle]}>
              {t('profile.unlockSecurityCodeNotice')}
            </Text>
          </View>

          {gateState === 'checking' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={s.form}>
              <AuthInput
                placeholder={t('profile.unlockSecurityCodePlaceholder')}
                value={securityCode}
                onChangeText={setSecurityCode}
                keyboardType="number-pad"
                secureTextEntry
              />
              {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
              <Pressable
                style={[
                  s.button,
                  d.button,
                  gateState === 'verifying' ? s.buttonDisabled : null,
                ]}
                onPress={handleUnlock}
                disabled={gateState === 'verifying'}
              >
                {gateState === 'verifying' ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={d.buttonText}>{t('profile.unlockSecurityCodeAction')}</Text>
                )}
              </Pressable>
              <Pressable style={s.textButton} onPress={handleLogout}>
                <Text style={d.textButton}>{t('profile.logoutToLogin')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
