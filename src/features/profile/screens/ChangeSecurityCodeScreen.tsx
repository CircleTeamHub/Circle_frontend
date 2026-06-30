import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import {
  disableLoginSecurityCode,
  setLoginSecurityCode,
} from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const SECURITY_CODE_PATTERN = /^\d{4,6}$/;

// 三种模式完全区分：enable=开启（仅新码）、change=修改（旧码+新码）、disable=关闭（仅旧码）。
// 模式由调用方（账号安全设置页）按当前开启状态决定，避免本页再去推断 enabled。
type SecurityCodeMode = 'enable' | 'change' | 'disable';

function normalizeMode(value: string | undefined): SecurityCodeMode {
  return value === 'change' || value === 'disable' ? value : 'enable';
}

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  form: {
    gap: Spacing.md,
  },
  helper: {
    ...Typography.caption,
  },
  error: {
    ...Typography.caption,
  },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default function ChangeSecurityCodeScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const mode = normalizeMode(rawMode);

  const [currentSecurityCode, setCurrentSecurityCode] = useState('');
  const [securityCode, setSecurityCode] = useState('');
  const [confirmSecurityCode, setConfirmSecurityCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const showCurrent = mode === 'change' || mode === 'disable';
  const showNew = mode === 'enable' || mode === 'change';
  const isDisable = mode === 'disable';

  const title =
    mode === 'enable'
      ? t('profile.enableSecurityCodeTitle')
      : mode === 'change'
        ? t('profile.changeSecurityCodeTitle')
        : t('profile.disableSecurityCodeTitle');

  const buttonLabel =
    mode === 'enable'
      ? t('profile.enableSecurityCode')
      : mode === 'change'
        ? t('common.save')
        : t('profile.disableSecurityCode');

  const helper =
    mode === 'disable'
      ? t('profile.disableSecurityCodeConfirm')
      : t('profile.securityCodeChangeNotice');

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      helper: {
        color: colors.textSecondary,
      },
      error: {
        color: colors.error,
      },
      button: {
        backgroundColor: isDisable ? colors.error : colors.primary,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors, isDisable],
  );

  async function handleSave() {
    setError(null);

    if (mode === 'change' && !SECURITY_CODE_PATTERN.test(currentSecurityCode)) {
      setError(t('profile.securityCodeInvalid'));
      return;
    }

    if (!SECURITY_CODE_PATTERN.test(securityCode)) {
      setError(t('profile.securityCodeInvalid'));
      return;
    }

    if (securityCode !== confirmSecurityCode) {
      setError(t('profile.securityCodeMismatch'));
      return;
    }

    if (mode === 'change' && currentSecurityCode === securityCode) {
      setError(t('profile.securityCodeUnchanged'));
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);

    try {
      await setLoginSecurityCode({
        oldSecurityCode: mode === 'change' ? currentSecurityCode : undefined,
        securityCode,
      });
      router.back();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, t('profile.securityCodeSaveFailed')),
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleDisable() {
    setError(null);

    if (!SECURITY_CODE_PATTERN.test(currentSecurityCode)) {
      setError(t('profile.securityCodeInvalid'));
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);

    try {
      await disableLoginSecurityCode(currentSecurityCode);
      router.back();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, t('profile.securityCodeDisableFailed')),
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    if (inFlightRef.current) return;

    if (!isDisable) {
      void handleSave();
      return;
    }

    Alert.alert(
      t('profile.disableSecurityCodeTitle'),
      t('profile.disableSecurityCodeConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.disableSecurityCode'),
          style: 'destructive',
          onPress: () => void handleDisable(),
        },
      ],
    );
  }

  return (
    <KeyboardAvoidingView
      style={[d.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NavHeader title={title} />
      <ScrollView
        contentContainerStyle={[
          s.container,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
        {...keyboardDismissOnDragProps}
      >
        <View style={s.form}>
          {showCurrent ? (
            <AuthInput
              label={t('profile.currentSecurityCode')}
              placeholder={t('profile.currentSecurityCodePlaceholder')}
              value={currentSecurityCode}
              onChangeText={setCurrentSecurityCode}
              keyboardType="number-pad"
              secureTextEntry
            />
          ) : null}
          {showNew ? (
            <>
              <AuthInput
                label={
                  mode === 'change'
                    ? t('profile.newSecurityCode')
                    : t('profile.securityCode')
                }
                placeholder={t('profile.newSecurityCodePlaceholder')}
                value={securityCode}
                onChangeText={setSecurityCode}
                keyboardType="number-pad"
                secureTextEntry
              />
              <AuthInput
                label={t('profile.confirmSecurityCode')}
                placeholder={t('profile.confirmSecurityCodePlaceholder')}
                value={confirmSecurityCode}
                onChangeText={setConfirmSecurityCode}
                keyboardType="number-pad"
                secureTextEntry
              />
            </>
          ) : null}
          <Pressable
            style={[s.button, d.button, submitting ? s.buttonDisabled : null]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={d.buttonText}>{buttonLabel}</Text>
            )}
          </Pressable>
          <Text style={[s.helper, d.helper]}>{helper}</Text>
          {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
