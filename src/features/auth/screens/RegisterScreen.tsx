import { useState, useMemo } from 'react';
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
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { useAuth } from '@/hooks/use-auth';

const s = StyleSheet.create({
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
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
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);

  const d = useMemo(() => ({
    outer: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
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
    dividerLine: {
      backgroundColor: colors.surfaceBorder,
    },
    dividerText: {
      color: colors.textSecondary,
    },
    socialBtn: {
      borderColor: colors.surfaceBorder,
    },
    loginHint: {
      color: colors.textSecondary,
      ...Typography.bodyRegular,
    },
    loginLink: {
      color: colors.primary,
    },
  }), [colors, insets.top, insets.bottom]);

  return (
    <View style={d.outer}>
      <NavHeader title="创建账号" />
      <ScrollView
        contentContainerStyle={[
          s.container,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
      {/* Title */}
      <View style={s.titleWrap}>
        <Text style={d.heading}>创建账号</Text>
        <Text style={d.subtitle}>填写账号信息完成注册</Text>
      </View>

      {/* Form */}
      <AuthInput
        label="账号"
        placeholder="请输入账号"
        value={account}
        onChangeText={setAccount}
      />

      <AuthInput
        label="密码"
        placeholder="请输入密码（6-20位）"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <AuthInput
        label="确认密码"
        placeholder="请再次输入密码"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />

      <AuthInput
        label="昵称"
        placeholder="给自己取个名字吧"
        value={nickname}
        onChangeText={setNickname}
      />

      {/* Agreement */}
      <Pressable style={s.agreementRow} onPress={() => setAgreed(!agreed)}>
        <View style={[s.checkbox, d.checkbox, agreed && d.checkboxChecked]}>
          {agreed ? (
            <Ionicons name="checkmark" size={12} color={colors.white} />
          ) : null}
        </View>
        <Text style={[s.agreementText, d.agreementText]}>
          我已阅读并同意《用户协议》和《隐私政策》
        </Text>
      </Pressable>

      {/* Error */}
      {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}

      {/* Register button */}
      <Pressable
        style={[s.registerBtn, d.registerBtn, submitting && s.btnDisabled]}
        onPress={() => register(account, password, nickname, confirmPassword)}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={[s.registerBtnText, d.registerBtnText]}>注册</Text>
        )}
      </Pressable>

      {/* Divider */}
      <View style={s.dividerRow}>
        <View style={[s.dividerLine, d.dividerLine]} />
        <Text style={[s.dividerText, d.dividerText]}>或</Text>
        <View style={[s.dividerLine, d.dividerLine]} />
      </View>

      {/* Social */}
      <View style={s.socialRow}>
        <Pressable style={[s.socialBtn, d.socialBtn]}>
          <Ionicons name="chatbubble-ellipses" size={24} color="#07C160" />
        </Pressable>
      </View>

      <View style={s.spacer} />

      {/* Login link */}
      <View style={s.loginRow}>
        <Text style={d.loginHint}>已有账号？</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={[s.loginLink, d.loginLink]}>立即登录</Text>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}
