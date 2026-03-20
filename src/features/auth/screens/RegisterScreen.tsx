import React, { useState, useCallback, useMemo } from 'react';
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
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { AuthInput } from '@/components/ui/auth-input';
import { useAuth } from '@/hooks/use-auth';

const TABS = ['手机号', '邮箱'] as const;

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { register, sendCode, submitting, error } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const styles = useMemo(() => StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      paddingHorizontal: Spacing.lg,
      gap: 20,
    },
    backBtn: {
      alignSelf: 'flex-start',
      paddingVertical: Spacing.md,
    },
    titleWrap: {
      gap: Spacing.sm,
    },
    heading: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '700',
    },
    subtitle: {
      color: colors.textSecondary,
      ...Typography.bodyRegular,
    },
    tabRow: {
      flexDirection: 'row',
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
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
      width: 40,
      backgroundColor: 'transparent',
    },
    tabLineActive: {
      backgroundColor: colors.primary,
    },
    codeRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.md,
    },
    codeInputWrap: {
      flex: 1,
    },
    sendBtn: {
      height: 52,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 0,
    },
    sendBtnDisabled: {
      opacity: 0.5,
    },
    sendBtnText: {
      color: colors.text,
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
      borderColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
    },
    agreementText: {
      color: colors.textSecondary,
      ...Typography.small,
      flex: 1,
    },
    error: {
      color: colors.error,
      ...Typography.caption,
    },
    registerBtn: {
      width: '100%',
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    btnDisabled: {
      opacity: 0.6,
    },
    registerBtnText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
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
      alignItems: 'center',
    },
    socialBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      justifyContent: 'center',
      alignItems: 'center',
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
    loginHint: {
      color: colors.textSecondary,
      ...Typography.bodyRegular,
    },
    loginLink: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
  }), [colors]);

  const handleSendCode = useCallback(async () => {
    const ok = await sendCode(phone);
    if (ok) {
      setCodeSent(true);
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((v) => {
          if (v <= 1) { clearInterval(timer); return 0; }
          return v - 1;
        });
      }, 1000);
    }
  }, [sendCode, phone]);

  const handleRegister = useCallback(() => {
    register(phone, code, password, nickname);
  }, [register, phone, code, password, nickname]);

  const SendCodeButton = (
    <Pressable
      style={[styles.sendBtn, countdown > 0 && styles.sendBtnDisabled]}
      onPress={handleSendCode}
      disabled={countdown > 0}
    >
      <Text style={styles.sendBtnText}>
        {countdown > 0 ? `${countdown}s` : '获取验证码'}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>

      {/* Title */}
      <View style={styles.titleWrap}>
        <Text style={styles.heading}>创建账号</Text>
        <Text style={styles.subtitle}>支持手机号、邮箱或微信注册</Text>
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
              style={[styles.tabText, i === activeTab && styles.tabTextActive]}
            >
              {tab}
            </Text>
            <View
              style={[styles.tabLine, i === activeTab && styles.tabLineActive]}
            />
          </Pressable>
        ))}
      </View>

      {/* Form fields */}
      <AuthInput
        label="手机号"
        placeholder="请输入手机号"
        prefix="+86"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />

      <View style={styles.codeRow}>
        <View style={styles.codeInputWrap}>
          <AuthInput
            label="验证码"
            placeholder="请输入验证码"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
          />
        </View>
        {SendCodeButton}
      </View>

      <AuthInput
        label="设置密码"
        placeholder="请输入密码（6-20位）"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <AuthInput
        label="昵称"
        placeholder="给自己取个名字吧"
        value={nickname}
        onChangeText={setNickname}
      />

      {/* Agreement */}
      <Pressable style={styles.agreementRow} onPress={() => setAgreed(!agreed)}>
        <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
          {agreed ? (
            <Ionicons name="checkmark" size={12} color={colors.white} />
          ) : null}
        </View>
        <Text style={styles.agreementText}>
          我已阅读并同意《用户协议》和《隐私政策》
        </Text>
      </Pressable>

      {/* Error */}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Register button */}
      <Pressable
        style={[styles.registerBtn, submitting && styles.btnDisabled]}
        onPress={handleRegister}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.registerBtnText}>注册</Text>
        )}
      </Pressable>

      {/* Divider */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>或</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Social */}
      <View style={styles.socialRow}>
        <Pressable style={styles.socialBtn}>
          <Ionicons name="chatbubble-ellipses" size={24} color="#07C160" />
        </Pressable>
      </View>

      <View style={styles.spacer} />

      {/* Login link */}
      <View style={styles.loginRow}>
        <Text style={styles.loginHint}>已有账号？</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.loginLink}>立即登录</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
