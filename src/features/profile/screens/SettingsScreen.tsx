import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/authStore';

interface SettingsRowItem {
  id: string;
  label: string;
  value?: string;
  type?: 'avatar' | 'text';
}

const PROFILE_ROWS: SettingsRowItem[] = [
  { id: 'avatar', label: '头像', type: 'avatar' },
  { id: 'frame', label: '头像框', value: '无' },
  { id: 'nickname', label: '昵称', value: '上海 深圳 玫瑰刺' },
  { id: 'gender', label: '性别', value: '未知' },
  { id: 'birthday', label: '生日', value: '未设置' },
  { id: 'bio', label: '个人简介', value: '未填写' },
  { id: 'wechat', label: '绑定微信', value: '未绑定' },
  { id: 'phone', label: '绑定手机号', value: '未绑定' },
  { id: 'qq', label: '绑定QQ号', value: '未绑定' },
];

const SECURITY_ROWS: SettingsRowItem[] = [
  { id: 'password', label: '修改登录密码' },
  { id: 'security-code', label: '登录安全码', value: '点击修改' },
];

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

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { logout } = useAuth();
  const user = useAuthStore((state) => state.user);

  const profileRows: SettingsRowItem[] = [
    { id: 'avatar', label: '头像', type: 'avatar' },
    { id: 'frame', label: '头像框', value: user?.avatarFrame ?? '无' },
    { id: 'nickname', label: '昵称', value: user?.nickname ?? '未设置' },
    { id: 'gender', label: '性别', value: user?.gender ?? 'unset' },
    { id: 'birthday', label: '生日', value: user?.birthday ?? '未设置' },
    { id: 'bio', label: '个人简介', value: user?.persona ?? '未填写' },
    { id: 'wechat', label: '绑定微信', value: user?.wechat ?? '未绑定' },
    { id: 'phone', label: '绑定手机号', value: user?.phoneNumber ?? '未绑定' },
    { id: 'qq', label: '绑定QQ号', value: user?.qq ?? '未绑定' },
  ];

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
      <Pressable style={s.row}>
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
          {SECURITY_ROWS.map((item, index) =>
            renderRow(item, index, SECURITY_ROWS.length),
          )}
        </View>

        <View style={s.footer}>
          <Pressable style={[s.secondaryButton, d.secondaryButton]}>
            <Text style={d.secondaryButtonText}>切换账号</Text>
          </Pressable>
          <Pressable style={[s.dangerButton, d.dangerButton]} onPress={logout}>
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={d.dangerButtonText}>退出登录</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
