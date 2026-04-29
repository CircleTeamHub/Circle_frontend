import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { changeAccountId } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  form: {
    gap: Spacing.md,
  },
  currentBox: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  helper: {
    ...Typography.caption,
  },
  error: {
    ...Typography.caption,
  },
  footer: {
    marginTop: 'auto',
    paddingBottom: Spacing.lg,
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

export default function ChangeAccountScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [accountId, setAccountId] = useState(user?.accountId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentAccountId = user?.accountId ?? '';

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      currentBox: {
        backgroundColor: colors.surface,
      },
      currentLabel: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      currentValue: {
        color: colors.text,
        ...Typography.h3,
      },
      helper: {
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
    }),
    [colors],
  );

  async function handleSave() {
    const nextAccountId = accountId.trim();
    setError(null);

    if (!ACCOUNT_ID_PATTERN.test(nextAccountId)) {
      setError(t('profile.accountIdInvalid'));
      return;
    }

    if (nextAccountId === currentAccountId) {
      setError(t('profile.accountIdUnchanged'));
      return;
    }

    if (!user) {
      setError(t('profile.returnToSettings'));
      return;
    }

    setSubmitting(true);

    try {
      await changeAccountId(nextAccountId);
      setUser({ ...user, accountId: nextAccountId });
      router.back();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('profile.accountChangeFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[d.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NavHeader title={t('profile.changeAccountId')} />
      <ScrollView
        contentContainerStyle={[
          s.container,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.form}>
          <View style={[s.currentBox, d.currentBox]}>
            <Text style={d.currentLabel}>{t('profile.currentAccountId')}</Text>
            <Text style={d.currentValue}>{currentAccountId || t('profile.notBound')}</Text>
          </View>
          <AuthInput
            label={t('profile.newAccountId')}
            placeholder={t('profile.newAccountIdPlaceholder')}
            value={accountId}
            onChangeText={setAccountId}
          />
          <Text style={[s.helper, d.helper]}>
            {t('profile.accountIdChangeNotice')}
          </Text>
          {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
        </View>

        <View style={s.footer}>
          <Pressable
            style={[
              s.button,
              d.button,
              submitting ? s.buttonDisabled : null,
            ]}
            onPress={handleSave}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={d.buttonText}>{t('common.save')}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
