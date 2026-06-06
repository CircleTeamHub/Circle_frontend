import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, useTheme } from '@/theme';
import { Divider } from '@/components/ui/divider';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/api/notifications';
import {
  fetchCircleActivities,
  markAllCircleActivitiesRead,
  markCircleActivityRead,
} from '@/services/api/circles';
import type { CircleActivityItem, NotificationItem } from '@/types';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import {
  mapNotificationToRow,
  type NotificationRowData,
} from '@/features/notifications/utils/notification-summary';
import { mapActivityToRow } from '@/features/notifications/utils/circle-activity-summary';
import { NotificationTabBar, type NotificationTabKey } from '@/features/notifications/components/NotificationTabBar';
import { ReadFilterBar, type ReadFilter } from '@/features/notifications/components/ReadFilterBar';
import { NotificationRow } from '@/features/notifications/components/NotificationRow';
import { NotificationEmptyState } from '@/features/notifications/components/NotificationEmptyState';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

interface Row {
  raw: NotificationItem | CircleActivityItem;
  view: NotificationRowData;
}

export default function NotificationCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const interactive = useNotificationCenterStore((s) => s.interactive);
  const circle = useNotificationCenterStore((s) => s.circle);
  const store = useNotificationCenterStore.getState;

  const [tab, setTab] = useState<NotificationTabKey>('interactive');
  const [filter, setFilter] = useState<ReadFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [n, a] = await Promise.all([
        fetchNotifications(1).catch(() => []),
        fetchCircleActivities().catch(() => []),
      ]);
      store().setInteractive(n);
      store().setCircle(a);
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  const interactiveUnread = useMemo(() => interactive.some((n) => !n.read), [interactive]);
  const circleUnread = useMemo(() => circle.some((a) => a.readAt === null), [circle]);

  const rows = useMemo<Row[]>(() => {
    const mapped: Row[] =
      tab === 'interactive'
        ? interactive.map((n) => ({ raw: n, view: mapNotificationToRow(n, t) }))
        : circle.map((a) => ({ raw: a, view: mapActivityToRow(a, t) }));
    return filter === 'unread' ? mapped.filter((r) => r.view.unread) : mapped;
  }, [tab, filter, interactive, circle, t]);

  const handleMarkAll = useCallback(async () => {
    if (tab === 'interactive') {
      store().markAllInteractiveReadLocal();
      await markAllNotificationsRead().catch((e) => isDev && console.warn(e));
    } else {
      store().markAllCircleReadLocal();
      await markAllCircleActivitiesRead().catch((e) => isDev && console.warn(e));
    }
  }, [tab, store]);

  const handleRowPress = useCallback(
    (id: string) => {
      if (tab === 'interactive') {
        store().markInteractiveReadLocal(id);
        void markNotificationRead(id).catch((e) => isDev && console.warn(e));
        // TODO(Task 3.6 follow-up): route TRACE_* → moment, FRIEND_REQUEST → friend flow
      } else {
        store().markCircleReadLocal(id);
        void markCircleActivityRead(id).catch((e) => isDev && console.warn(e));
      }
    },
    [tab, store],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
          {t('notifications.title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <NotificationTabBar
        active={tab}
        interactiveUnread={interactiveUnread}
        circleUnread={circleUnread}
        labels={{ interactive: t('notifications.tabInteractive'), circle: t('notifications.tabCircle') }}
        onSelect={setTab}
      />
      <ReadFilterBar
        filter={filter}
        labels={{ all: t('notifications.filterAll'), unread: t('notifications.filterUnread'), markAll: t('notifications.markAllRead') }}
        onSelect={setFilter}
        onMarkAll={handleMarkAll}
      />

      <FlatList
        data={rows}
        keyExtractor={(r) => r.view.id}
        renderItem={({ item }) => (
          <NotificationRow data={item.view} onPress={() => handleRowPress(item.view.id)} />
        )}
        ItemSeparatorComponent={Divider}
        refreshing={refreshing}
        onRefresh={load}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          <NotificationEmptyState
            title={t('notifications.emptyTitle')}
            subtitle={t('notifications.emptySubtitle')}
          />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
