import { useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import {
  formatProfileFieldValue,
  getProfileEditField,
} from '@/features/profile/profile-edit-config';

interface SettingsRowItem {
  id: string;
  label: string;
  value?: string;
  type?: 'avatar' | 'text';
  editable: boolean;
  unsupportedMessage?: string;
}

const PROFILE_ROW_IDS = [
  'avatar',
  'frame',
  'nickname',
  'gender',
  'birthday',
  'bio',
  'wechat',
  'phone',
  'qq',
] as const;

const SECURITY_ROW_IDS = ['password', 'security-code'] as const;

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  secondaryButton: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerButton: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
});

function getFieldValue(user: AuthUser | null, fieldId: string) {
  const field = getProfileEditField(fieldId);

  if (!user || !field || !('valueKey' in field) || !field.valueKey) {
    return '';
  }

  const value = user[field.valueKey as keyof AuthUser];
  return typeof value === 'string' ? value : '';
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { logout, switchAccount, submitting } = useAuth();
  const user = useAuthStore((state) => state.user);

  const profileRows = PROFILE_ROW_IDS.map((fieldId) => {
    const field = getProfileEditField(fieldId);

    if (!field) {
      return null;
    }

    return {
      id: field.id,
      label: field.label,
      type: field.rowType,
      value: formatProfileFieldValue(fieldId, getFieldValue(user, fieldId)),
      editable: field.editable,
      unsupportedMessage:
        'unsupportedMessage' in field ? field.unsupportedMessage : undefined,
    } satisfies SettingsRowItem;
  }).filter(Boolean) as SettingsRowItem[];

  const securityRows = SECURITY_ROW_IDS.map((fieldId) => {
    const field = getProfileEditField(fieldId);

    if (!field) {
      return null;
    }

    return {
      id: field.id,
      label: field.label,
      type: field.rowType,
      value: field.emptyValueLabel || undefined,
      editable: field.editable,
      unsupportedMessage:
        'unsupportedMessage' in field ? field.unsupportedMessage : undefined,
    } satisfies SettingsRowItem;
  }).filter(Boolean) as SettingsRowItem[];

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.lg,
        gap: Spacing.xl,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      rowLabel: {
        color: colors.text,
        ...Typography.body,
      },
      rowValue: {
        color: colors.textSecondary,
        ...Typography.caption,
        textAlign: 'right' as const,
        flexShrink: 1,
      },
      secondaryButton: {
        backgroundColor: colors.surface,
      },
      secondaryButtonText: {
        color: colors.primary,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      dangerButton: {
        backgroundColor: colors.error,
      },
      dangerButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.bottom],
  );

  const renderRow = (item: SettingsRowItem, index: number, total: number) => (
    <View key={item.id}>
      <Pressable style={s.row} onPress={() => handleRowPress(item)}>
        <Text style={d.rowLabel}>{item.label}</Text>
        <View style={s.rowRight}>
          {item.type === 'avatar' ? (
            <Avatar
              size={40}
              name={user?.nickname ?? user?.username ?? '圈'}
              uri={user?.avatarUrl ?? undefined}
            />
          ) : item.value ? (
            <Text style={d.rowValue} numberOfLines={1}>
              {item.value}
            </Text>
          ) : null}
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </View>
      </Pressable>
      {index < total - 1 ? <Divider /> : null}
    </View>
  );

  function handleRowPress(item: SettingsRowItem) {
    if (item.id === 'password') {
      router.push('/(tabs)/profile/change-password');
      return;
    }

    if (item.editable) {
      router.push({
        pathname: '/(tabs)/profile/edit/[field]',
        params: { field: item.id },
      });
      return;
    }

    Alert.alert(item.label, item.unsupportedMessage ?? '该功能暂未接入。');
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="账号设置" />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.section}>
          <Text style={d.sectionTitle}>个人信息</Text>
          {profileRows.map((item, index) =>
            renderRow(item, index, profileRows.length),
          )}
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>账号与安全</Text>
          {securityRows.map((item, index) =>
            renderRow(item, index, securityRows.length),
          )}
        </View>

        <View style={s.footer}>
          <Pressable
            style={[
              s.secondaryButton,
              d.secondaryButton,
              submitting ? { opacity: 0.6 } : null,
            ]}
            onPress={switchAccount}
            disabled={submitting}
          >
            <Text style={d.secondaryButtonText}>切换账号</Text>
          </Pressable>
          <Pressable
            style={[
              s.dangerButton,
              d.dangerButton,
              submitting ? { opacity: 0.6 } : null,
            ]}
            onPress={logout}
            disabled={submitting}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={d.dangerButtonText}>退出登录</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
