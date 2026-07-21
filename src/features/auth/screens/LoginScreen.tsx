import { AuthInput } from "@/components/ui/auth-input";
import { useAuth } from "@/hooks/use-auth";
import { useSendEmailCode } from "@/hooks/use-send-email-code";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

type Mode = "password" | "code";

const APP_LOGO_SOURCE = require("../../../../assets/images/login-logo-plane.png");

const s = StyleSheet.create({
  scroll: { flex: 1 },
  container: { paddingHorizontal: Spacing.lg, alignItems: "center", gap: 28 },
  logoPlane: { width: 80, height: 80, marginBottom: -4 },
  headingGroup: { alignItems: "center", gap: Spacing.sm, width: "100%" },
  heading: { fontSize: 28, fontWeight: "700" },
  subtitle: { ...Typography.body },
  segment: {
    flexDirection: "row",
    width: "100%",
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    height: 40,
    borderRadius: Radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentText: { fontSize: 14, fontWeight: "600" },
  form: { width: "100%", gap: Spacing.md },
  sendBtn: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  sendBtnText: { fontSize: 13, fontWeight: "600" },
  forgotRow: { alignItems: "flex-end" },
  forgotLink: { ...Typography.caption },
  error: { ...Typography.caption },
  loginBtn: {
    width: "100%",
    height: 52,
    borderRadius: Radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: 16, fontWeight: "600" },
  registerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  registerHint: { ...Typography.bodyRegular },
  registerLink: { fontSize: 14, fontWeight: "600" },
});

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { login, loginWithCode, submitting, error } = useAuth();
  const { t } = useTranslation();
  // 从「切换账号」过期分支或注册成功跳来时预填邮箱。
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState(emailParam ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const sendCode = useSendEmailCode("login");
  const { isOffline } = useNetworkStatus();

  const d = useMemo(
    () => ({
      scroll: { backgroundColor: colors.background },
      heading: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      segment: { backgroundColor: colors.surface },
      segmentActive: { backgroundColor: colors.primary },
      segmentText: { color: colors.textSecondary },
      segmentTextActive: { color: colors.white },
      forgotLink: { color: colors.primary },
      error: { color: colors.error },
      loginBtn: { backgroundColor: colors.primary },
      loginBtnText: { color: colors.white },
      registerHint: { color: colors.textSecondary },
      registerLink: { color: colors.primary },
    }),
    [colors],
  );

  const onSendCode = useCallback(() => {
    sendCode.send(email);
  }, [sendCode, email]);

  const onForgotPassword = useCallback(() => {
    // FE#92：真实重置流程（circle_be PR #120 起后端可用），不再是占位提示。
    // 新路由在 expo typegen 重新生成前先 as never（仓内 group-call 同款惯例）
    router.push("/(auth)/forgot-password" as never);
  }, []);

  const onSubmit = useCallback(() => {
    if (mode === "password") {
      login(email, password);
    } else {
      loginWithCode(email, code);
    }
  }, [mode, login, loginWithCode, email, password, code]);

  return (
    <ScrollView
      style={[s.scroll, d.scroll]}
      contentContainerStyle={[
        s.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
      {...keyboardDismissOnDragProps}
    >
      {/* Logo */}
      <Image
        source={APP_LOGO_SOURCE}
        style={s.logoPlane}
        resizeMode="contain"
        accessibilityLabel="风信"
      />

      {/* Heading */}
      <View style={s.headingGroup}>
        <Text style={[s.heading, d.heading]}>{t("auth.welcomeBack")}</Text>
        <Text style={[s.subtitle, d.subtitle]}>{t("auth.loginSubtitle")}</Text>
      </View>

      {/* 登录方式切换 */}
      <View style={[s.segment, d.segment]}>
        {(["password", "code"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            style={[s.segmentItem, mode === m && d.segmentActive]}
            onPress={() => setMode(m)}
          >
            <Text
              style={[
                s.segmentText,
                mode === m ? d.segmentTextActive : d.segmentText,
              ]}
            >
              {t(m === "password" ? "auth.passwordLogin" : "auth.codeLogin")}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Form */}
      <View style={s.form}>
        <AuthInput
          placeholder={t("auth.emailPlaceholder")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />

        {mode === "password" ? (
          <>
            <AuthInput
              placeholder={t("auth.passwordPlaceholder")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
            />
            <View style={s.forgotRow}>
              <Pressable onPress={onForgotPassword} hitSlop={8}>
                <Text style={[s.forgotLink, d.forgotLink]}>
                  {t("auth.forgotPassword")}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <AuthInput
            placeholder={t("auth.codePlaceholder")}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            rightElement={
              <Pressable
                style={s.sendBtn}
                onPress={onSendCode}
                disabled={sendCode.running || sendCode.sending}
                hitSlop={8}
              >
                <Text
                  style={[
                    s.sendBtnText,
                    {
                      color:
                        sendCode.running || sendCode.sending
                          ? colors.textSecondary
                          : colors.primary,
                    },
                  ]}
                >
                  {sendCode.running
                    ? t("auth.resendCodeIn", { seconds: sendCode.seconds })
                    : sendCode.sending
                      ? t("auth.sendingCode", { defaultValue: "发送中…" })
                      : t("auth.sendCode")}
                </Text>
              </Pressable>
            }
          />
        )}
      </View>

      {/* Offline / Error */}
      {isOffline ? (
        <Text style={[s.error, d.error]}>{t("auth.offlineHint")}</Text>
      ) : null}
      {sendCode.error ? (
        <Text style={[s.error, d.error]}>{sendCode.error}</Text>
      ) : null}
      {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}

      {/* Login button */}
      <Pressable
        style={[s.loginBtn, d.loginBtn, submitting && s.btnDisabled]}
        onPress={onSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={[s.loginBtnText, d.loginBtnText]}>{t("auth.login")}</Text>
        )}
      </Pressable>

      {/* Register link */}
      <View style={s.registerRow}>
        <Text style={[s.registerHint, d.registerHint]}>
          {t("auth.noAccount")}
        </Text>
        <Link href="/(auth)/register" asChild>
          <Pressable>
            <Text style={[s.registerLink, d.registerLink]}>
              {t("auth.registerNow")}
            </Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}
