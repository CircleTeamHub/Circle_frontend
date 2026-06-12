import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography } from '@/theme';
import { useTranslation } from 'react-i18next';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { useAuth } from '@/hooks/use-auth';
import { useCountdown } from '@/hooks/use-countdown';
import { requestEmailCode } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';

const s = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    gap: 20,
  },
  titleWrap: {
    gap: Spacing.sm,
  },
  sendBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agreementText: {
    ...Typography.small,
    flex: 1,
  },
  error: {
    ...Typography.caption,
  },
  registerBtn: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  registerBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  spacer: {
    flex: 1,
    minHeight: Spacing.lg,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { register, submitting, error } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const countdown = useCountdown();

  const d = useMemo(
    () => ({
      outer: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      heading: {
        color: colors.text,
        fontSize: 28,
        fontWeight: '700' as const,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      checkbox: {
        borderColor: colors.primary,
      },
      checkboxChecked: {
        backgroundColor: colors.primary,
      },
      agreementText: {
        color: colors.textSecondary,
      },
      error: {
        color: colors.error,
      },
      registerBtn: {
        backgroundColor: colors.primary,
      },
      registerBtnText: {
        color: colors.white,
      },
      loginHint: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      loginLink: {
        color: colors.primary,
      },
    }),
    [colors, insets.top],
  );

  const onSendCode = useCallback(async () => {
    setSendError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setSendError(t('auth.invalidEmail', { defaultValue: '邮箱格式不正确' }));
      return;
    }
    try {
      await requestEmailCode({ email: normalizedEmail, purpose: 'register' });
      countdown.start(60);
    } catch (e) {
      setSendError(getApiErrorMessage(e, '发送失败，请重试'));
    }
  }, [email, countdown, t]);

  return (
    <View style={d.outer}>
      <NavHeader title={t('auth.createAccount')} />
      <ScrollView
        contentContainerStyle={[
          s.container,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={s.titleWrap}>
          <Text style={d.heading}>{t('auth.createAccount')}</Text>
          <Text style={d.subtitle}>{t('auth.registerSubtitle')}</Text>
        </View>

        {/* Form */}
        <AuthInput
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />

        <AuthInput
          label={t('auth.codePlaceholder')}
          placeholder={t('auth.codePlaceholder')}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          rightElement={
            <Pressable
              onPress={onSendCode}
              disabled={countdown.running}
              hitSlop={8}
            >
              <Text
                style={[
                  s.sendBtnText,
                  {
                    color: countdown.running
                      ? colors.textSecondary
                      : colors.primary,
                  },
                ]}
              >
                {countdown.running
                  ? t('auth.resendCodeIn', { seconds: countdown.seconds })
                  : t('auth.sendCode')}
              </Text>
            </Pressable>
          }
        />

        <AuthInput
          label={t('auth.password')}
          placeholder={t('auth.passwordHint')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
        />

        <AuthInput
          label={t('auth.nickname')}
          placeholder={t('auth.nicknameHint')}
          value={nickname}
          onChangeText={setNickname}
          textContentType="nickname"
          autoComplete="name"
        />

        {/* Agreement */}
        <Pressable style={s.agreementRow} onPress={() => setAgreed(!agreed)}>
          <View style={[s.checkbox, d.checkbox, agreed && d.checkboxChecked]}>
            {agreed ? (
              <Ionicons name="checkmark" size={12} color={colors.white} />
            ) : null}
          </View>
          <Text style={[s.agreementText, d.agreementText]}>
            {t('auth.agreement')}
          </Text>
        </Pressable>

        {/* Error */}
        {sendError ? <Text style={[s.error, d.error]}>{sendError}</Text> : null}
        {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}

        {/* Register button — 必须同时勾选协议且未在提交中才允许触发；
            视觉禁用 + 提前 return 双重防 onPress 触发。 */}
        <Pressable
          style={[
            s.registerBtn,
            d.registerBtn,
            (submitting || !agreed) && s.btnDisabled,
          ]}
          onPress={() => {
            if (submitting || !agreed) return;
            register(email, code, password, nickname);
          }}
          disabled={submitting || !agreed}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={[s.registerBtnText, d.registerBtnText]}>
              {t('auth.register')}
            </Text>
          )}
        </Pressable>

        <View style={s.spacer} />

        {/* Login link — 用 replace 而不是 back，避免深链 / 推送场景下
            back 到非 (auth) 栈或栈底空。 */}
        <View style={s.loginRow}>
          <Text style={d.loginHint}>{t('auth.hasAccount')}</Text>
          <Pressable onPress={() => router.replace('/(auth)/login')}>
            <Text style={[s.loginLink, d.loginLink]}>{t('auth.loginNow')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
