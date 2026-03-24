import React, { useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { NotificationListItem } from '@/features/messages/data/notifications';

interface NotificationListProps {
  title: string;
  subtitle: string;
  items: NotificationListItem[];
}

export const NotificationList: React.FC<NotificationListProps> = ({
  title,
  subtitle,
  items,
}) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        listContent: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
        sectionHeader: {
          paddingTop: Spacing.md,
          paddingBottom: Spacing.lg,
          gap: Spacing.xs,
        },
        sectionTitle: {
          color: colors.text,
          ...Typography.h2,
        },
        sectionSubtitle: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: Radius.lg,
          paddingHorizontal: Spacing.md,
        },
        itemRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: Spacing.md,
          paddingVertical: Spacing.md,
        },
        body: {
          flex: 1,
          gap: Spacing.xs,
        },
        topRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: Spacing.sm,
        },
        name: {
          color: colors.text,
          ...Typography.body,
          flexShrink: 1,
        },
        time: {
          color: colors.textSecondary,
          ...Typography.small,
        },
        message: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
          lineHeight: 20,
        },
        target: {
          color: colors.text,
          ...Typography.caption,
        },
        unreadDot: {
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.primary,
          marginTop: 6,
        },
        readIcon: {
          marginTop: 2,
        },
        emptyText: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title={title} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.card}>
            <Pressable style={styles.itemRow}>
              <Avatar size={40} name={item.name} uri={item.avatarUrl} />
              <View style={styles.body}>
                <View style={styles.topRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.time}>{item.time}</Text>
                </View>
                <Text style={styles.message}>{item.actionText}</Text>
                <Text style={styles.target} numberOfLines={1}>
                  {item.target}
                </Text>
              </View>
              {item.unread ? (
                <View style={styles.unreadDot} />
              ) : (
                <Ionicons
                  style={styles.readIcon}
                  name="checkmark-done-outline"
                  size={16}
                  color={colors.textSecondary}
                />
              )}
            </Pressable>
            {index < items.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>暂无消息</Text>}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};
