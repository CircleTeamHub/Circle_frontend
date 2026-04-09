import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthInput } from '@/components/ui/auth-input';
import { NavHeader } from '@/components/ui/nav-header';
import { changePassword, logoutAll } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { clearLocalSession } from '@/services/auth/session';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  form: {
    gap: Spacing.md,
  },
  helper: {
    ...Typography.caption,
  },
  error: {
    ...Typography.caption,
  },
  footer: {
    marginTop: 'auto',
    paddingBottom: Spacing.lg,
  },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      helper: {
        color: colors.textSecondary,
      },
      error: {
        color: colors.error,
      },
      button: {
        backgroundColor: colors.primary,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  async function handleSave() {
    setError(null);

    if (!oldPassword) {
      setError('请输入当前密码');
      return;
    }

    if (newPassword.length < 6 || newPassword.length > 64) {
      setError('新密码需为 6-64 位');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    setSubmitting(true);

    try {
      await changePassword({
        oldPassword,
        newPassword,
      });
      try {
        await logoutAll();
      } catch {
        // 服务端登出全部设备失败不阻断本地退出流程
      }
      await clearLocalSession();
      router.replace('/(auth)/login');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '修改密码失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[d.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NavHeader title="修改登录密码" />
      <ScrollView
        contentContainerStyle={[
          s.container,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.form}>
          <AuthInput
            label="当前密码"
            placeholder="请输入当前密码"
            value={oldPassword}
            onChangeText={setOldPassword}
            secureTextEntry
          />
          <AuthInput
            label="新密码"
            placeholder="请输入 6-64 位新密码"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
          />
          <AuthInput
            label="确认新密码"
            placeholder="请再次输入新密码"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
          <Text style={[s.helper, d.helper]}>
            密码修改成功后，当前设备和其他设备都需要重新登录。
          </Text>
          {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
        </View>

        <View style={s.footer}>
          <Pressable
            style={[
              s.button,
              d.button,
              submitting ? s.buttonDisabled : null,
            ]}
            onPress={handleSave}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={d.buttonText}>保存</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
