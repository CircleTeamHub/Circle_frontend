import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  fetchProfileNotifications,
  markProfileNotificationsRead,
} from '@/services/api/notifications';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import type { NotificationItem } from '@/types';

const ANNOUNCEMENTS = [
  {
    id: 'latestAppInfo',
    titleKey: 'systemAnnouncements.latestAppInfo.title',
    metaKey: 'systemAnnouncements.latestAppInfo.meta',
    bodyKey: 'systemAnnouncements.latestAppInfo.body',
  },
  {
    id: 'updates',
    titleKey: 'systemAnnouncements.updates.title',
    metaKey: 'systemAnnouncements.updates.meta',
    bodyKey: 'systemAnnouncements.updates.body',
  },
  {
    id: 'patches',
    titleKey: 'systemAnnouncements.patches.title',
    metaKey: 'systemAnnouncements.patches.meta',
    bodyKey: 'systemAnnouncements.patches.body',
  },
] as const;
const PAGE_SIZE = 20;

const s = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
});

export default function SystemAnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const setProfileUnread = useTabBadgeStore((state) => state.setProfileUnread);
  const mountedRef = useRef(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.md,
      },
      intro: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 21,
      },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      title: {
        color: colors.text,
        ...Typography.h3,
      },
      meta: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      body: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 21,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors, insets.bottom],
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await fetchProfileNotifications(1);
      if (!mountedRef.current) return;
      setItems(rows);
      setPage(1);
      setHasMore(rows.length >= PAGE_SIZE);
      setLoadError(null);
    } catch (error) {
      reportNotificationFailure('notification_load_more_failed', error, {
        page: 1,
      });
      if (mountedRef.current) {
        setLoadError(
          t('systemAnnouncements.loadFailed', {
            defaultValue: '系统通知加载失败，请下拉重试',
          }),
        );
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void markProfileNotificationsRead()
        .then(() => {
          if (active) setProfileUnread(0);
        })
        .catch((error) => {
          reportNotificationFailure(
            'notification_mark_all_read_failed',
            error,
          );
        });
      return () => {
        active = false;
      };
    }, [setProfileUnread]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || refreshing || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const rows = await fetchProfileNotifications(nextPage);
      if (!mountedRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...rows.filter((item) => !seen.has(item.id))];
      });
      setPage(nextPage);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (error) {
      reportNotificationFailure('notification_load_more_failed', error, {
        page: nextPage,
      });
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page, refreshing]);

  const renderSystemNotification = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <View style={[s.card, d.card]}>
        <View style={s.cardHeader}>
          <Ionicons
            name="notifications-outline"
            size={20}
            color={colors.primary}
          />
          <Text style={d.title}>{t('notifications.system')}</Text>
        </View>
        <Text style={d.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
        <Text style={d.body}>{item.content}</Text>
      </View>
    ),
    [colors.primary, d, t],
  );

  const ListHeader = (
    <View style={{ gap: Spacing.md }}>
      <Text style={d.intro}>{t('systemAnnouncements.subtitle')}</Text>

      {ANNOUNCEMENTS.map((item) => (
        <View key={item.id} style={[s.card, d.card]}>
          <View style={s.cardHeader}>
            <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
            <Text style={d.title}>{t(item.titleKey)}</Text>
          </View>
          <Text style={d.meta}>{t(item.metaKey)}</Text>
          <Text style={d.body}>{t(item.bodyKey)}</Text>
        </View>
      ))}

      <Text style={d.sectionTitle}>
        {t('systemAnnouncements.systemNotifications')}
      </Text>
      {loadError ? <Text style={d.emptyText}>{loadError}</Text> : null}
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('systemAnnouncements.title')} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderSystemNotification}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          loadError ? null : (
            <View style={s.empty}>
              <Ionicons
                name="checkmark-circle-outline"
                size={28}
                color={colors.textSecondary}
              />
              <Text style={d.emptyText}>{t('systemAnnouncements.empty')}</Text>
            </View>
          )
        }
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={load}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
      />
    </View>
  );
}
