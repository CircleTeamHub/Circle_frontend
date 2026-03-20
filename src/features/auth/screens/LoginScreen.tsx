import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { AuthInput } from '@/components/ui/auth-input';
import { useAuth } from '@/hooks/use-auth';

const TABS = ['手机号', '邮箱'] as const;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { login, submitting, error } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const styles = useMemo(() => StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      paddingHorizontal: Spacing.lg,
      alignItems: 'center',
      gap: 28,
    },
    logo: {
      width: 72,
      height: 72,
      borderRadius: Radius.lg,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    logoOuter: {
      position: 'absolute',
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 4,
      borderColor: 'rgba(255,255,255,0.19)',
    },
    logoMiddle: {
      position: 'absolute',
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.31)',
    },
    logoDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.white,
    },
    headingGroup: {
      alignItems: 'center',
      gap: Spacing.sm,
      width: '100%',
    },
    heading: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '700',
    },
    subtitle: {
      color: colors.textSecondary,
      ...Typography.body,
    },
    tabRow: {
      flexDirection: 'row',
      width: '100%',
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingTop: Spacing.sm,
    },
    tabText: {
      color: colors.textSecondary,
      ...Typography.bodyRegular,
      fontWeight: '500',
    },
    tabTextActive: {
      color: colors.text,
      fontWeight: '600',
    },
    tabLine: {
      height: 2,
      borderRadius: 1,
      width: '100%',
      backgroundColor: 'transparent',
    },
    tabLineActive: {
      backgroundColor: colors.primary,
    },
    form: {
      width: '100%',
      gap: Spacing.md,
    },
    forgotRow: {
      alignItems: 'flex-end',
    },
    forgotLink: {
      color: colors.primary,
      ...Typography.caption,
    },
    error: {
      color: colors.error,
      ...Typography.caption,
    },
    loginBtn: {
      width: '100%',
      height: 52,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    btnDisabled: {
      opacity: 0.6,
    },
    loginBtnText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      width: '100%',
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.surfaceBorder,
    },
    dividerText: {
      color: colors.textSecondary,
      ...Typography.caption,
    },
    socialRow: {
      flexDirection: 'row',
      gap: Spacing.lg,
    },
    socialBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    registerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    registerHint: {
      color: colors.textSecondary,
      ...Typography.bodyRegular,
    },
    registerLink: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
  }), [colors]);

  const handleLogin = useCallback(() => {
    login(phone, password);
  }, [login, phone, password]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo */}
      <View style={styles.logo}>
        <View style={styles.logoOuter} />
        <View style={styles.logoMiddle} />
        <View style={styles.logoDot} />
      </View>

      {/* Heading */}
      <View style={styles.headingGroup}>
        <Text style={styles.heading}>欢迎回来</Text>
        <Text style={styles.subtitle}>登录你的账号</Text>
      </View>

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        {TABS.map((tab, i) => (
          <Pressable
            key={tab}
            style={styles.tab}
            onPress={() => setActiveTab(i)}
          >
            <Text
              style={[
                styles.tabText,
                i === activeTab && styles.tabTextActive,
              ]}
            >
              {tab}
            </Text>
            <View
              style={[
                styles.tabLine,
                i === activeTab && styles.tabLineActive,
              ]}
            />
          </Pressable>
        ))}
      </View>

      {/* Form */}
      <View style={styles.form}>
        <AuthInput
          placeholder="请输入手机号"
          prefix="+86"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <AuthInput
          placeholder="请输入密码"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <View style={styles.forgotRow}>
          <Text style={styles.forgotLink}>忘记密码?</Text>
        </View>
      </View>

      {/* Error */}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Login button */}
      <Pressable
        style={[styles.loginBtn, submitting && styles.btnDisabled]}
        onPress={handleLogin}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.loginBtnText}>登录</Text>
        )}
      </Pressable>

      {/* Divider */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>或</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Social login */}
      <View style={styles.socialRow}>
        <Pressable style={styles.socialBtn}>
          <Ionicons name="chatbubble-ellipses" size={24} color="#07C160" />
        </Pressable>
      </View>

      {/* Register link */}
      <View style={styles.registerRow}>
        <Text style={styles.registerHint}>没有账号？</Text>
        <Link href="/(auth)/register" asChild>
          <Pressable>
            <Text style={styles.registerLink}>立即注册</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}
