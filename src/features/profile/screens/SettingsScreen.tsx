import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.lg,
          gap: Spacing.xl,
        },
        section: {
          gap: Spacing.sm,
        },
        sectionTitle: {
          color: colors.textSecondary,
          ...Typography.caption,
          fontWeight: '600',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: Spacing.md,
          paddingVertical: Spacing.md,
        },
        rowLabel: {
          color: colors.text,
          ...Typography.body,
        },
        rowRight: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          flexShrink: 1,
        },
        rowValue: {
          color: colors.textSecondary,
          ...Typography.caption,
          textAlign: 'right',
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
          backgroundColor: colors.surface,
          justifyContent: 'center',
          alignItems: 'center',
        },
        secondaryButtonText: {
          color: colors.primary,
          ...Typography.body,
          fontWeight: '600',
        },
        dangerButton: {
          flex: 1,
          height: 52,
          borderRadius: Radius.lg,
          backgroundColor: colors.error,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: Spacing.sm,
        },
        dangerButtonText: {
          color: colors.white,
          ...Typography.body,
          fontWeight: '600',
        },
      }),
    [colors, insets.bottom],
  );

  const renderRow = (item: SettingsRowItem, index: number, total: number) => (
    <View key={item.id}>
      <Pressable style={styles.row}>
        <Text style={styles.rowLabel}>{item.label}</Text>
        <View style={styles.rowRight}>
          {item.type === 'avatar' ? (
            <Avatar
              size={40}
              name="圈"
              uri="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200"
            />
          ) : item.value ? (
            <Text style={styles.rowValue} numberOfLines={1}>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="账号设置" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>个人信息</Text>
          {PROFILE_ROWS.map((item, index) =>
            renderRow(item, index, PROFILE_ROWS.length),
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>账号与安全</Text>
          {SECURITY_ROWS.map((item, index) =>
            renderRow(item, index, SECURITY_ROWS.length),
          )}
        </View>

        <View style={styles.footer}>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>切换账号</Text>
          </Pressable>
          <Pressable style={styles.dangerButton}>
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={styles.dangerButtonText}>退出登录</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
