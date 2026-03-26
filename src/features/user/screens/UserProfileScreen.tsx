import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ProfileActionRow } from '@/features/user/components/profile-action-row';
import { getUserProfileById } from '@/features/user/data/profiles';

const INFO_ROWS = [
  '朋友圈',
  '设置备注',
  '标签',
  '给该用户赠送金币',
  '更多信息',
] as const;

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();

  const profile = getUserProfileById(
    typeof params.id === 'string' ? params.id : 'unknown',
    typeof params.name === 'string' ? params.name : undefined,
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + 104,
        },
        headerBlock: {
          flexDirection: 'row',
          gap: Spacing.md,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.md,
          alignItems: 'flex-start',
        },
        avatarFrame: {
          width: 68,
          height: 68,
          borderRadius: Radius.md,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        avatarImage: {
          width: '100%',
          height: '100%',
        },
        avatarFallback: {
          color: colors.white,
          fontSize: 26,
          fontWeight: '700',
        },
        info: {
          flex: 1,
          gap: 6,
        },
        nameRow: {
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
        },
        name: {
          color: colors.text,
          fontSize: 22,
          fontWeight: '700',
        },
        badge: {
          backgroundColor: colors.primaryLight,
          borderRadius: Radius.full,
          paddingHorizontal: 8,
          paddingVertical: 4,
        },
        badgeText: {
          color: colors.primary,
          ...Typography.tiny,
          fontWeight: '600',
        },
        account: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
        chipRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
        },
        chip: {
          backgroundColor: colors.surface,
          borderRadius: Radius.full,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        chipText: {
          color: colors.textSecondary,
          ...Typography.tiny,
          fontWeight: '600',
        },
        signature: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
        listSection: {
          marginTop: Spacing.md,
        },
        actionSection: {
          borderTopWidth: 1,
          borderTopColor: colors.divider,
          marginTop: Spacing.md,
          paddingTop: Spacing.lg,
          paddingBottom: Spacing.lg,
          gap: Spacing.md,
          alignItems: 'center',
        },
        actionText: {
          color: colors.primary,
          ...Typography.body,
          fontWeight: '600',
        },
        footer: {
          position: 'absolute',
          left: Spacing.lg,
          right: Spacing.lg,
          bottom: insets.bottom + Spacing.md,
        },
        addButton: {
          height: 48,
          borderRadius: Radius.lg,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        addButtonText: {
          color: colors.white,
          ...Typography.body,
          fontWeight: '600',
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="个人信息" rightIcon="ellipsis-horizontal" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBlock}>
          <View style={styles.avatarFrame}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarFallback}>
                {profile.name.charAt(0)}
              </Text>
            )}
          </View>
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile.remarkHint ?? profile.name}</Text>
              {profile.badges.map((badge) => (
                <View key={badge} style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.account}>圈号：{profile.accountId}</Text>
            <View style={styles.chipRow}>
              {profile.tagChips.map((chip) => (
                <View key={chip} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.signature}>{profile.signature}</Text>
          </View>
        </View>

        <View style={styles.listSection}>
          <Divider />
          {INFO_ROWS.map((label, index) => (
            <View key={label}>
              <ProfileActionRow label={label} />
              {index < INFO_ROWS.length - 1 ? <Divider /> : null}
            </View>
          ))}
          <Divider />
        </View>

        <View style={styles.actionSection}>
          <Pressable>
            <Text style={styles.actionText}>发起聊天</Text>
          </Pressable>
          <Pressable>
            <Text style={styles.actionText}>音视频通话</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.addButton}>
          <Text style={styles.addButtonText}>添加好友</Text>
        </Pressable>
      </View>
    </View>
  );
}
