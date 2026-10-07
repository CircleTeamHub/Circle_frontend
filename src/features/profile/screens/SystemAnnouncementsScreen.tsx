import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  fetchProfileNotificationsPage,
  markProfileNotificationsRead,
} from '@/services/api/notifications';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useAuthStore } from '@/stores/authStore';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { SYSTEM_ANNOUNCEMENTS } from '@/features/profile/system-announcements';
import type { NotificationItem } from '@/types';

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
});

export default function SystemAnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const setProfileUnread = useTabBadgeStore((state) => state.setProfileUnread);
  const ownerId = useAuthStore((state) => state.user?.id);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const sessionKey = `${ownerId ?? ''}:${sessionEpoch}`;
  const mountedRef = useRef(true);
  const paginationEpochRef = useRef(0);
  const pageInFlightRef = useRef(false);
  const cachedSessionRef = useRef(sessionKey);
  const [cachedSessionKey, setCachedSessionKey] = useState(sessionKey);
  const [pageError, setPageError] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibleItems = cachedSessionKey === sessionKey ? items : [];
  const isCurrentSession = useCallback(() => {
    const auth = useAuthStore.getState();
    return mountedRef.current && auth.user?.id === ownerId && auth.sessionEpoch === sessionEpoch;
  }, [ownerId, sessionEpoch]);

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
        flex: 1,
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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    const epoch = ++paginationEpochRef.current;
    setRefreshing(true);
    setLoadingMore(false);
    pageInFlightRef.current = false;
    setPageError(false);
    if (cachedSessionRef.current !== sessionKey) {
      cachedSessionRef.current = sessionKey;
      setCachedSessionKey(sessionKey);
      setItems([]);
      setNextCursor(null);
      setLoadError(null);
    }
    if (!ownerId) {
      setRefreshing(false);
      return;
    }
    try {
      const result = await fetchProfileNotificationsPage();
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;
      setItems(result.items);
      setNextCursor(result.nextCursor);
      setLoadError(null);
    } catch (error) {
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;
      reportNotificationFailure('notification_load_more_failed', error, {
        cursor: null,
      });
      if (isCurrentSession() && epoch === paginationEpochRef.current) {
        setLoadError(
          t('systemAnnouncements.loadFailed', {
            defaultValue: '系统通知加载失败，请下拉重试',
          }),
        );
      }
    } finally {
      if (
        isCurrentSession() &&
        epoch === paginationEpochRef.current
      ) {
        setRefreshing(false);
      }
    }
  }, [isCurrentSession, ownerId, sessionKey, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!ownerId) return;
      void markProfileNotificationsRead()
        .then(() => {
          if (active && isCurrentSession()) setProfileUnread(0);
        })
        .catch((error) => {
          if (!active || !isCurrentSession()) return;
          reportNotificationFailure(
            'notification_mark_all_read_failed',
            error,
          );
        });
      return () => {
        active = false;
      };
    }, [isCurrentSession, ownerId, setProfileUnread]),
  );

  const loadMore = useCallback(async (retry = false) => {
    if (!ownerId || !isCurrentSession() || cachedSessionKey !== sessionKey || pageInFlightRef.current || loadingMore || refreshing || !nextCursor || (pageError && !retry)) return;
    pageInFlightRef.current = true;
    setPageError(false);
    const epoch = paginationEpochRef.current;
    setLoadingMore(true);
    try {
      const result = await fetchProfileNotificationsPage(nextCursor);
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...result.items.filter((item) => !seen.has(item.id)),
        ];
      });
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (!isCurrentSession() || epoch !== paginationEpochRef.current) return;
      setPageError(true);
      reportNotificationFailure('notification_load_more_failed', error, {
        cursor: nextCursor,
      });
    } finally {
      if (
        isCurrentSession() &&
        epoch === paginationEpochRef.current
      ) {
        pageInFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [cachedSessionKey, isCurrentSession, loadingMore, nextCursor, ownerId, pageError, refreshing, sessionKey]);

  const renderSystemNotification = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <View style={[s.card, d.card]}>
        <View style={s.cardHeader}>
          <Ionicons
            name="notifications-outline"
            size={20}
            color={colors.iconAccent}
          />
          <Text style={d.title}>{t('notifications.system')}</Text>
        </View>
        <Text style={d.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
        <Text style={d.body}>{item.content}</Text>
      </View>
    ),
    [colors.iconAccent, d, t],
  );

  const ListHeader = (
    <View style={{ gap: Spacing.md }}>
      <Text style={d.intro}>{t('systemAnnouncements.subtitle')}</Text>

      {SYSTEM_ANNOUNCEMENTS.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={t('systemAnnouncements.openAnnouncement', {
            defaultValue: '查看{{title}}详情',
            title: t(item.titleKey),
          })}
          style={[s.card, d.card]}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/profile/system-announcements/[id]',
              params: { id: item.id },
            })
          }
        >
          <View style={s.cardHeader}>
            <Ionicons name="megaphone-outline" size={20} color={colors.iconAccent} />
            <Text style={d.title}>{t(item.titleKey)}</Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          </View>
          <Text style={d.meta}>{t(item.metaKey)}</Text>
          <Text numberOfLines={2} style={d.body}>
            {t(item.bodyKey)}
          </Text>
        </Pressable>
      ))}

      {visibleItems.length > 0 || (cachedSessionKey === sessionKey && loadError) ? (
        <>
          <Text style={d.sectionTitle}>
            {t('systemAnnouncements.systemNotifications')}
          </Text>
          {loadError ? <Text style={d.emptyText}>{loadError}</Text> : null}
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('systemAnnouncements.title')} />
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        renderItem={renderSystemNotification}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={null}
        ListFooterComponent={cachedSessionKey === sessionKey && pageError ? (
          <Pressable accessibilityRole="button" onPress={() => { void loadMore(true); }}>
            <Text style={d.emptyText}>{t('common.retry', { defaultValue: '重试' })}</Text>
          </Pressable>
        ) : null}
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={load}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.4}
      />
    </View>
  );
}
