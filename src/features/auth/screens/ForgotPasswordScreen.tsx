import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  validateCode,
  validateEmail,
  validatePassword,
} from '@/features/auth/validation';
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
  // review 修复：state 版 disabled 要等重渲染才生效，快速双击会用同一枚
  // 验证码双发 /auth/password/reset（第一发消费一次性码 + 全端下线，
  // 第二发只会带回一个费解的失败）。ref 同步生效。
  const submitInFlightRef = useRef(false);
  // round 3 review：提交后离开本页时，成功继续段的 Alert/router.back 会
  // 弹在别的页面上、pop 掉用户新去的屏 —— unmount 后跳过 UI 副作用。
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
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
    if (!canSubmit || submitInFlightRef.current) return;
    setError(null);
    // review 修复：与共享校验契约对齐（6 位验证码 + 密码长度上限）——
    // 4/5 位残码、超 64 字符的粘贴密码不再打到后端变成格式错误的重置尝试，
    // 白白消耗敏感限流配额。
    const invalidField =
      validateEmail(email) ?? validateCode(code) ?? validatePassword(newPassword);
    if (invalidField) {
      setError(t(invalidField));
      return;
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      await resetPassword({ email, code, newPassword });
      if (!mountedRef.current) return;
      Alert.alert(
        t('auth.resetPassword.successTitle', { defaultValue: '密码已重置' }),
        t('auth.resetPassword.successBody', {
          defaultValue: '所有设备已退出登录，请用新密码重新登录。',
        }),
        [{ text: t('common.ok', { defaultValue: '好的' }) }],
      );
      // review 修复：深链/网页刷新直达本页时栈里没有登录页，back() 是
      // no-op，会把用户留在还带着验证码/新密码的表单上。
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(auth)/login');
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(
        getApiErrorMessage(
          e,
          t('auth.resetPassword.failed', {
            defaultValue: '重置失败，请检查验证码后重试',
          }),
        ),
      );
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
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
      {/* round 3 review：深链直达时无导航历史，返回键要有登录页兜底 */}
      <NavHeader
        title={t('auth.forgotPassword', { defaultValue: '忘记密码' })}
        fallbackHref="/(auth)/login"
      />
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
