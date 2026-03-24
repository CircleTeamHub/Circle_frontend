import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Typography, useTheme } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATIONS_BY_CATEGORY,
  getUnreadNotificationCountByCategory,
} from '@/features/messages/data/notifications';
import type {
  NotificationCategory,
  NotificationListItem,
} from '@/features/messages/data/notifications';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [activeCategory, setActiveCategory] =
    useState<NotificationCategory['id']>('likes');

  const unreadItems = useMemo(
    () =>
      NOTIFICATIONS_BY_CATEGORY[activeCategory].filter((item) => item.unread),
    [activeCategory],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          gap: Spacing.xl,
        },
        listContent: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
        cardRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: Spacing.md,
          paddingTop: Spacing.md,
        },
        cardButton: {
          flex: 1,
          alignItems: 'center',
          gap: Spacing.sm,
          position: 'relative',
        },
        iconBox: {
          width: 54,
          height: 54,
          borderRadius: 16,
          justifyContent: 'center',
          alignItems: 'center',
        },
        cardTitle: {
          color: colors.text,
          fontSize: 12,
          fontWeight: '700',
        },
        cardsOnly: {
          paddingTop: Spacing.md,
        },
        listSpacer: {
          height: Spacing.xl,
        },
        categoryBadge: {
          position: 'absolute',
          top: -6,
          right: 8,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.md,
          paddingVertical: Spacing.md,
        },
        rowContent: {
          flex: 1,
          gap: Spacing.xs,
        },
        topRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: Spacing.sm,
        },
        name: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
          flex: 1,
          marginRight: Spacing.sm,
        },
        time: {
          color: colors.textSecondary,
          ...Typography.small,
        },
        actionText: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
        target: {
          color: colors.text,
          ...Typography.body,
        },
        emptyText: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
          textAlign: 'center',
          paddingTop: Spacing.xl,
        },
      }),
    [colors, insets.bottom],
  );

  const renderHeader = useMemo(
    () => (
      <View style={styles.content}>
        <View style={[styles.cardRow, styles.cardsOnly]}>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <Pressable
              key={category.id}
              style={styles.cardButton}
              onPress={() => setActiveCategory(category.id)}
            >
              <View
                style={[
                  styles.iconBox,
                  { backgroundColor: category.backgroundColor },
                ]}
              >
                <Ionicons
                  name={category.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={category.iconColor}
                />
              </View>
              <Text style={styles.cardTitle}>{category.title}</Text>
              <View style={styles.categoryBadge}>
                <Badge count={getUnreadNotificationCountByCategory(category.id)} />
              </View>
            </Pressable>
          ))}
        </View>
        <View style={styles.listSpacer} />
      </View>
    ),
    [styles],
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationListItem }) => (
      <Pressable style={styles.row}>
        <Avatar size={40} name={item.name} uri={item.avatarUrl} />
        <View style={styles.rowContent}>
          <View style={styles.topRow}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.time}>{item.time}</Text>
          </View>
          <Text style={styles.actionText} numberOfLines={1}>
            {item.actionText}
          </Text>
          <Text style={styles.target} numberOfLines={1}>
            {item.target}
          </Text>
        </View>
      </Pressable>
    ),
    [styles],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="动态通知" />
      <FlatList
        data={unreadItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={<Text style={styles.emptyText}>暂无未读通知</Text>}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
