import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { useSendEmailCode } from '@/hooks/use-send-email-code';
import { resetPassword } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { validateEmail } from '@/features/auth/validation';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const s = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    gap: 20,
  },
  titleWrap: {
    gap: Spacing.sm,
  },
  title: {
    ...Typography.h2,
  },
  subtitle: {
    ...Typography.bodyRegular,
  },
  sendBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    ...Typography.caption,
  },
  submitBtn: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

/**
 * 忘记密码（FE#92）：邮箱 → 验证码 → 新密码。
 * 发码复用 useSendEmailCode（reset-password 目的走独立端点，防枚举语义在后端）；
 * 重置成功后后端已全端下线，引导回登录页用新密码登录。
 */
export function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendCode = useSendEmailCode('reset-password');

  const canSubmit =
    !submitting &&
    email.trim().length > 0 &&
    code.trim().length >= 4 &&
    newPassword.length >= 6;

  const onSendCode = useCallback(() => {
    void sendCode.send(email);
  }, [sendCode, email]);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    const invalidEmail = validateEmail(email);
    if (invalidEmail) {
      setError(t(invalidEmail));
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ email, code, newPassword });
      Alert.alert(
        t('auth.resetPassword.successTitle', { defaultValue: '密码已重置' }),
        t('auth.resetPassword.successBody', {
          defaultValue: '所有设备已退出登录，请用新密码重新登录。',
        }),
        [{ text: t('common.ok', { defaultValue: '好的' }) }],
      );
      router.back();
    } catch (e) {
      setError(
        getApiErrorMessage(
          e,
          t('auth.resetPassword.failed', {
            defaultValue: '重置失败，请检查验证码后重试',
          }),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, email, code, newPassword, router, t]);

  const d = useMemo(
    () => ({
      page: { flex: 1, backgroundColor: colors.background },
      title: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      sendText: { color: colors.primary },
      sendTextDisabled: { color: colors.textSecondary },
      error: { color: colors.error },
      submit: { backgroundColor: colors.primary },
      submitDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
    }),
    [colors],
  );

  return (
    <View style={[d.page, { paddingTop: insets.top }]}>
      <NavHeader title={t('auth.forgotPassword', { defaultValue: '忘记密码' })} />
      <ScrollView
        contentContainerStyle={s.container}
        {...keyboardDismissOnDragProps}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.titleWrap}>
          <Text style={[s.subtitle, d.subtitle]}>
            {t('auth.resetPassword.intro', {
              defaultValue: '输入注册邮箱，我们会发送验证码用于重置密码。',
            })}
          </Text>
        </View>

        <AuthInput
          placeholder={t('auth.emailPlaceholder', { defaultValue: '邮箱' })}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
        />
        <AuthInput
          placeholder={t('auth.codePlaceholder', { defaultValue: '验证码' })}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          rightElement={
            <Pressable
              onPress={onSendCode}
              disabled={sendCode.sending || sendCode.running}
            >
              <Text
                style={[
                  s.sendBtnText,
                  sendCode.sending || sendCode.running
                    ? d.sendTextDisabled
                    : d.sendText,
                ]}
              >
                {sendCode.running
                  ? t('auth.resendIn', {
                      seconds: sendCode.seconds,
                      defaultValue: '{{seconds}}s 后重发',
                    })
                  : t('auth.sendCode', { defaultValue: '发送验证码' })}
              </Text>
            </Pressable>
          }
        />
        <AuthInput
          placeholder={t('auth.resetPassword.newPasswordPlaceholder', {
            defaultValue: '新密码（至少 6 位）',
          })}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
        />

        {error || sendCode.error ? (
          <Text style={[s.error, d.error]}>{error ?? sendCode.error}</Text>
        ) : null}

        <Pressable
          style={[s.submitBtn, canSubmit ? d.submit : d.submitDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          <Text style={[s.submitText, d.submitText]}>
            {submitting
              ? t('auth.resetPassword.submitting', { defaultValue: '重置中…' })
              : t('auth.resetPassword.submit', { defaultValue: '重置密码' })}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
