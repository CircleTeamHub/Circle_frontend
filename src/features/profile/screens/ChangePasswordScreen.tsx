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
import { changePassword, logoutAll } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { clearLocalSession } from '@/services/auth/session';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);

    if (!oldPassword) {
      setError(t('profile.currentPasswordPlaceholder'));
      return;
    }

    if (newPassword.length < 6 || newPassword.length > 64) {
      setError(t('profile.passwordLengthError'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('profile.passwordMismatch'));
      return;
    }

    setSubmitting(true);

    try {
      await changePassword({
        oldPassword,
        newPassword,
      });
      try {
        await logoutAll();
      } catch {
        // 服务端登出全部设备失败不阻断本地退出流程
      }
      await clearLocalSession();
      router.replace('/(auth)/login');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, t('profile.passwordChangeFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[d.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NavHeader title={t('profile.changePassword')} />
      <ScrollView
        contentContainerStyle={[
          s.container,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.form}>
          <AuthInput
            label={t('profile.currentPassword')}
            placeholder={t('profile.currentPasswordPlaceholder')}
            value={oldPassword}
            onChangeText={setOldPassword}
            secureTextEntry
          />
          <AuthInput
            label={t('profile.newPassword')}
            placeholder={t('profile.newPasswordPlaceholder')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
          />
          <AuthInput
            label={t('profile.confirmNewPassword')}
            placeholder={t('profile.confirmNewPasswordPlaceholder')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
          <Text style={[s.helper, d.helper]}>
            {t('profile.passwordChangeNotice')}
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
