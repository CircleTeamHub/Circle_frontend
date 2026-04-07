import { AuthInput } from "@/components/ui/auth-input";
import { useAuth } from "@/hooks/use-auth";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { useState, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const s = StyleSheet.create({
  scroll: { flex: 1 },
  container: { paddingHorizontal: Spacing.lg, alignItems: "center", gap: 28 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  logoOuter: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.19)",
  },
  logoMiddle: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.31)",
  },
  logoDot: { width: 12, height: 12, borderRadius: 6 },
  headingGroup: { alignItems: "center", gap: Spacing.sm, width: "100%" },
  heading: { fontSize: 28, fontWeight: "700" },
  subtitle: { ...Typography.body },
  form: { width: "100%", gap: Spacing.md },
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
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    width: "100%",
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { ...Typography.caption },
  socialRow: { flexDirection: "row", gap: Spacing.lg },
  socialBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  registerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  registerHint: { ...Typography.bodyRegular },
  registerLink: { fontSize: 14, fontWeight: "600" },
});

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { login, submitting, error } = useAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");

  const d = useMemo(
    () => ({
      scroll: { backgroundColor: colors.background },
      logo: { backgroundColor: colors.primary },
      logoDot: { backgroundColor: colors.white },
      heading: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      forgotLink: { color: colors.primary },
      error: { color: colors.error },
      loginBtn: { backgroundColor: colors.primary },
      loginBtnText: { color: colors.white },
      dividerLine: { backgroundColor: colors.surfaceBorder },
      dividerText: { color: colors.textSecondary },
      socialBtn: { borderColor: colors.surfaceBorder },
      registerHint: { color: colors.textSecondary },
      registerLink: { color: colors.primary },
    }),
    [colors],
  );

  return (
    <ScrollView
      style={[s.scroll, d.scroll]}
      contentContainerStyle={[
        s.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo */}
      <View style={[s.logo, d.logo]}>
        <View style={s.logoOuter} />
        <View style={s.logoMiddle} />
        <View style={[s.logoDot, d.logoDot]} />
      </View>

      {/* Heading */}
      <View style={s.headingGroup}>
        <Text style={[s.heading, d.heading]}>欢迎回来</Text>
        <Text style={[s.subtitle, d.subtitle]}>登录你的账号</Text>
      </View>

      {/* Form */}
      <View style={s.form}>
        <AuthInput
          placeholder="请输入账号"
          value={account}
          onChangeText={setAccount}
        />
        <AuthInput
          placeholder="请输入密码"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <View style={s.forgotRow}>
          <Text style={[s.forgotLink, d.forgotLink]}>忘记密码?</Text>
        </View>
      </View>

      {/* Error */}
      {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}

      {/* Login button */}
      <Pressable
        style={[s.loginBtn, d.loginBtn, submitting && s.btnDisabled]}
        onPress={() => login(account, password)}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={[s.loginBtnText, d.loginBtnText]}>登录</Text>
        )}
      </Pressable>

      {/* Divider */}
      <View style={s.dividerRow}>
        <View style={[s.dividerLine, d.dividerLine]} />
        <Text style={[s.dividerText, d.dividerText]}>或</Text>
        <View style={[s.dividerLine, d.dividerLine]} />
      </View>

      {/* Social login */}
      <View style={s.socialRow}>
        <Pressable style={[s.socialBtn, d.socialBtn]}>
          <Ionicons name="chatbubble-ellipses" size={24} color="#07C160" />
        </Pressable>
      </View>

      {/* Register link */}
      <View style={s.registerRow}>
        <Text style={[s.registerHint, d.registerHint]}>没有账号？</Text>
        <Link href="/(auth)/register" asChild>
          <Pressable>
            <Text style={[s.registerLink, d.registerLink]}>立即注册</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}
