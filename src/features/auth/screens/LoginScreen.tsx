import { AuthInput } from '@/components/ui/auth-input';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import {
  LoginModeSegment,
  type LoginModeOption,
} from '@/features/auth/components/LoginModeSegment';
import { LoginPrimaryButton } from '@/features/auth/components/LoginPrimaryButton';
import { LoginSky } from '@/features/auth/components/LoginSky';
import { QrLoginPane } from '@/features/auth/components/QrLoginPane';
import {
  SKY_MAX_WIDTH,
  getSkyLayout,
} from '@/features/auth/components/login-sky-geometry';
import { useAuth } from '@/hooks/use-auth';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useSendEmailCode } from '@/hooks/use-send-email-code';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { Spacing, Typography, useTheme } from '@/theme';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// qr 档只在桌面网页版放出（手机自己就是扫码器）。
type Mode = 'password' | 'code' | 'qr';

const s = StyleSheet.create({
  flex: { flex: 1 },
  // 表单列：手机上撑满，平板 / 网页上和 hero 一样最宽 480 并居中。
  column: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: SKY_MAX_WIDTH,
    paddingHorizontal: Spacing.lg,
  },
  heading: { ...Typography.title, lineHeight: 40 },
  subtitle: { ...Typography.body, lineHeight: 20, marginTop: 14 },
  segmentWrap: { marginTop: Spacing.lg },
  form: { marginTop: 20, gap: 12 },
  forgotRow: { marginTop: Spacing.sm, height: 18, alignItems: 'flex-end', justifyContent: 'center' },
  forgotLink: { ...Typography.caption },
  // 错误 / 离线提示的占位始终保留，提示出现时登录键不会往下跳。
  messageSlot: { marginTop: 12, minHeight: 20, gap: 4 },
  message: { ...Typography.caption },
  buttonWrap: { marginTop: Spacing.md },
  registerRow: {
    marginTop: Spacing.lg,
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  registerHint: { ...Typography.bodyRegular },
  registerLink: { fontSize: 14, fontWeight: '600' },
  sendBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  sendBtnText: { fontSize: 13, fontWeight: '600' },
});

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const { login, loginWithCode, completeQrLogin, submitting, error } = useAuth();
  const { t } = useTranslation();
  // 从「切换账号」过期分支或注册成功跳来时预填邮箱。
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(emailParam ?? "");
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const sendCode = useSendEmailCode('login');
  const { isOffline } = useNetworkStatus();
  const sky = getSkyLayout(width);

  const modeOptions = useMemo(() => {
    const options: LoginModeOption<Mode>[] = [
      { value: 'password', label: t('auth.passwordLogin'), testID: E2E_TEST_IDS.authPasswordMode },
      { value: 'code', label: t('auth.codeLogin'), testID: E2E_TEST_IDS.authCodeMode },
    ];
    if (Platform.OS === 'web') {
      options.push({ value: 'qr', label: t('auth.qrLogin') });
    }
    return options;
  }, [t]);

  const onSendCode = useCallback(() => {
    sendCode.send(email);
  }, [sendCode, email]);

  const onForgotPassword = useCallback(() => {
    // FE#92：真实重置流程（circle_be PR #120 起后端可用），不再是占位提示。
    // 新路由在 expo typegen 重新生成前先 as never（仓内 group-call 同款惯例）
    router.push("/(auth)/forgot-password" as never);
  }, []);

  const onSubmit = useCallback(() => {
    if (mode === 'password') {
      login(email, password);
    } else {
      loginWithCode(email, code);
    }
  }, [mode, login, loginWithCode, email, password, code]);

  // 提示槽的 accessibilityLiveRegion 只在安卓 / 网页生效，iOS VoiceOver 要主动播报。
  const announcement = error ?? sendCode.error ?? (isOffline ? t('auth.offlineHint') : null);
  useEffect(() => {
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  const sendCodeBusy = sendCode.running || sendCode.sending;
  const sendCodeLabel = sendCode.running
    ? t('auth.resendCodeIn', { seconds: sendCode.seconds })
    : sendCode.sending
      ? t('auth.sendingCode', { defaultValue: '发送中…' })
      : t('auth.sendCode');

  return (
    <KeyboardAvoidingView
      style={[s.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        testID={E2E_TEST_IDS.authLoginScreen}
        style={s.flex}
        contentContainerStyle={{ paddingTop: sky.contentTop, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        {/* 夜空 hero：绝对定位在滚动内容顶部，随内容一起滚走 */}
        <LoginSky width={width} reduceMotion={reduceMotion} />

        <View style={s.column}>
          <Text style={[s.heading, { color: colors.text }]} accessibilityRole="header">
            {t('auth.welcomeBack')}
          </Text>
          <Text style={[s.subtitle, { color: colors.textSecondary }]}>
            {t('auth.loginSubtitle')}
          </Text>

          <View style={s.segmentWrap}>
            <LoginModeSegment options={modeOptions} value={mode} onChange={setMode} />
          </View>

          {/* Form：qr 档整体换成扫码面板（邮箱 / 密码输入无意义） */}
          {mode === 'qr' ? (
            <View style={s.form}>
              <QrLoginPane onTokens={completeQrLogin} />
            </View>
          ) : (
            <View style={s.form}>
              <AuthInput
                testID={E2E_TEST_IDS.authEmailInput}
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />

              {mode === 'password' ? (
                <>
                  <AuthInput
                    testID={E2E_TEST_IDS.authPasswordInput}
                    placeholder={t('auth.passwordPlaceholder')}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                  />
                  <View style={s.forgotRow}>
                    <Pressable onPress={onForgotPassword} hitSlop={8} accessibilityRole="link">
                      <Text style={[s.forgotLink, { color: colors.link }]}>
                        {t('auth.forgotPassword')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <AuthInput
                  testID={E2E_TEST_IDS.authCodeInput}
                  placeholder={t('auth.codePlaceholder')}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  rightElement={
                    <Pressable
                      testID={E2E_TEST_IDS.authSendCode}
                      style={s.sendBtn}
                      onPress={onSendCode}
                      disabled={sendCodeBusy}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: sendCodeBusy }}
                    >
                      <Text
                        style={[
                          s.sendBtnText,
                          { color: sendCodeBusy ? colors.textSecondary : colors.link },
                        ]}
                      >
                        {sendCodeLabel}
                      </Text>
                    </Pressable>
                  }
                />
              )}
            </View>
          )}

          {/* 离线 / 发码错误 / 登录错误共用一个保留高度的提示槽 */}
          <View style={s.messageSlot} accessibilityLiveRegion="polite">
            {isOffline ? (
              <Text style={[s.message, { color: colors.textSecondary }]}>
                {t('auth.offlineHint')}
              </Text>
            ) : null}
            {sendCode.error ? (
              <Text style={[s.message, { color: colors.error }]}>{sendCode.error}</Text>
            ) : null}
            {error ? <Text style={[s.message, { color: colors.error }]}>{error}</Text> : null}
          </View>

          {/* 登录键（qr 档没有提交动作，轮询自动完成） */}
          {mode === 'qr' ? null : (
            <View style={s.buttonWrap}>
              <LoginPrimaryButton
                testID={E2E_TEST_IDS.authSubmit}
                label={t('auth.login')}
                onPress={onSubmit}
                disabled={submitting}
                loading={submitting}
              />
            </View>
          )}

          <View style={s.registerRow}>
            <Text style={[s.registerHint, { color: colors.textSecondary }]}>
              {t('auth.noAccount')}
            </Text>
            <Link href="/(auth)/register" asChild>
              <Pressable hitSlop={8} accessibilityRole="link">
                <Text style={[s.registerLink, { color: colors.link }]}>
                  {t('auth.registerNow')}
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
