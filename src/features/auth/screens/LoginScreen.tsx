import { AuthInput } from '@/components/ui/auth-input';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { LoginPrimaryButton } from '@/features/auth/components/LoginPrimaryButton';
import { LoginSky } from '@/features/auth/components/LoginSky';
import {
  SKY_MAX_WIDTH,
  getSkyLayout,
} from '@/features/auth/components/login-sky-geometry';
import { useAuth } from '@/hooks/use-auth';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { Spacing, Typography, useTheme } from '@/theme';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
  form: { marginTop: 20, gap: 12 },
  // 用 minHeight 而不是 height:系统字号调大、或西语/日语这类更长的译文下,
  // 「忘记密码」会换行或超过 18pt。写死高度的话溢出的文字会压到下面的提示槽上,
  // 这个登录入口既看不清也不好点。
  forgotRow: {
    marginTop: Spacing.sm,
    minHeight: 18,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  forgotLink: { ...Typography.caption },
  // 错误 / 离线提示的占位始终保留，提示出现时登录键不会往下跳。
  // 槽里只会有一条消息(见 statusMessage),上限两行,所以按两行预留。
  messageSlot: { marginTop: 12, minHeight: 36 },
  message: { ...Typography.caption, lineHeight: 18 },
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
});

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const { login, submitting, error } = useAuth();
  const { t } = useTranslation();
  // 从「切换账号」过期分支或注册成功跳来时预填登录标识。
  // 保留 email 作为旧深链参数，避免已有链接失效。
  const { email: emailParam, identifier: identifierParam } =
    useLocalSearchParams<{ email?: string; identifier?: string }>();
  const [identifier, setIdentifier] = useState(identifierParam ?? emailParam ?? "");
  const [password, setPassword] = useState('');
  const { isOffline } = useNetworkStatus();
  const sky = getSkyLayout(width);

  const onForgotPassword = useCallback(() => {
    // FE#92：真实重置流程（circle_be PR #120 起后端可用），不再是占位提示。
    // 新路由在 expo typegen 重新生成前先 as never（仓内 group-call 同款惯例）
    router.push("/(auth)/forgot-password" as never);
  }, []);

  const onSubmit = useCallback(() => {
    login(identifier, password);
  }, [login, identifier, password]);

  // 登录错误和离线提示共用一个保留高度的提示槽，避免登录键跳动。
  const statusMessage = error ?? (isOffline ? t('auth.offlineHint') : null);
  const statusIsError = Boolean(error);
  // 提示槽的 accessibilityLiveRegion 只在安卓 / 网页生效，iOS VoiceOver 要主动播报。
  // 安卓上不能也主动播一次:live region 已经会播,再调一次就是同一句念两遍。
  useEffect(() => {
    if (Platform.OS !== 'ios' || !statusMessage) return;
    AccessibilityInfo.announceForAccessibility(statusMessage);
  }, [statusMessage]);

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

          <View style={s.form}>
            <AuthInput
              testID={E2E_TEST_IDS.authEmailInput}
              placeholder={t('auth.loginIdentifierPlaceholder')}
              value={identifier}
              onChangeText={setIdentifier}
              textContentType="username"
              autoComplete="username"
            />

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
          </View>

          {/* 离线 / 登录错误共用一个保留高度的提示槽 */}
          <View style={s.messageSlot} accessibilityLiveRegion="polite">
            {statusMessage ? (
              <Text
                style={[
                  s.message,
                  { color: statusIsError ? colors.error : colors.textSecondary },
                ]}
                // 长错误文案要有上界,否则换行照样把登录键顶下去。
                numberOfLines={2}
              >
                {statusMessage}
              </Text>
            ) : null}
          </View>

          <View style={s.buttonWrap}>
            <LoginPrimaryButton
              testID={E2E_TEST_IDS.authSubmit}
              label={t('auth.login')}
              onPress={onSubmit}
              disabled={submitting}
              loading={submitting}
            />
          </View>

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
