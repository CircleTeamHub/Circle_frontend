import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import type { AbnormalInactiveDays } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { AbnormalMemberItem } from '@/features/chat/components/group-abnormal/AbnormalMemberItem';
import { AbnormalMembersActionBar } from '@/features/chat/components/group-abnormal/AbnormalMembersActionBar';
import {
  AbnormalMembersHeader,
  type AbnormalReasonFilter,
} from '@/features/chat/components/group-abnormal/AbnormalMembersHeader';
import { evictGroupInfoCache } from '@/features/chat/group-info-cache';
import {
  type AbnormalMemberRow,
  useGroupAbnormalMembers,
} from '@/features/chat/hooks/use-group-abnormal-members';
import { useGroupAdminActions } from '@/features/chat/hooks/use-group-admin-actions';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/** 一次最多移出的人数:两种群的移出端点每分钟限 20 次,超过必然有人被限流打回。 */
export const ABNORMAL_BATCH_REMOVE_LIMIT = 20;

const s = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: Spacing.lg },
  // 列表行连成一张卡片:首行圆上角、末行圆下角,中间直角相接。
  card: { marginHorizontal: Spacing.md, overflow: 'hidden' },
  cardFirst: {
    marginTop: Spacing.md,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  cardLast: { borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyTitle: { ...Typography.body },
  emptyHint: { ...Typography.small, textAlign: 'center' },
  retry: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
  },
});

const matchesFilter = (row: AbnormalMemberRow, filter: AbnormalReasonFilter) =>
  filter === 'ALL' || row.flag.reasons.includes(filter);

/**
 * 异常成员:长期未登录、信誉值低。群主/管理员勾选后批量移出;服务端只列本人有权
 * 移出的人,移出前 useGroupAdminActions 还会现场重查本人角色。
 */
export default function GroupAbnormalMembersScreen() {
  const sessionKey = useAuthStore((state) =>
    state.user?.id ? `${state.user.id}:${state.sessionEpoch}` : null,
  );
  const { conversationID } = useLocalSearchParams<{ conversationID?: string }>();
  return sessionKey ? <AbnormalMembersContent key={`${sessionKey}:${conversationID ?? ''}`} /> : null;
}

function AbnormalMembersContent() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationID?: string; groupID?: string }>();
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const currentUserID = useChatStore((state) => state.currentUserId);
  const ownerId = useChatStore(
    (state) => state.conversations.find((item) => item.id === conversationID)?.ownerId ?? null,
  );
  const [inactiveDays, setInactiveDays] = useState<AbnormalInactiveDays>(30);
  const [filter, setFilter] = useState<AbnormalReasonFilter>('ALL');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const data = useGroupAbnormalMembers({
    conversationID,
    groupID,
    currentUserID,
    ownerId,
    inactiveDays,
  });
  const { removeRow } = data;
  // 进页面、移出成员后的自动重拉只走 data.loading;下拉刷新控件只跟下拉走,见 usePullRefresh。
  const pull = usePullRefresh(data.reload);

  const groupAdmin = useGroupAdminActions({
    conversationID,
    groupID,
    isStandaloneGroup: !groupID,
    currentUserID,
    selfRole: data.selfRole,
    onMemberUpdated: () => {},
    onMemberRemoved: (userId) => {
      // 与群管理页/群聊信息页共用一份成员缓存,移出后作废,回去时重拉。
      evictGroupInfoCache(sessionEpoch, groupID ? `circle:${groupID}` : `standalone:${conversationID}`);
      removeRow(userId);
      setSelected((current) => {
        if (!current.has(userId)) return current;
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    },
    onError: (err) => {
      reportHandledFailure('groupAbnormalMembers', 'remove', err);
      Alert.alert(t('common.errorOccurred'), getApiErrorMessage(err, t('common.networkError')));
    },
  });

  const counts = useMemo(
    () => ({
      ALL: data.rows.length,
      INACTIVE: data.rows.filter((row) => matchesFilter(row, 'INACTIVE')).length,
      LOW_CREDIT: data.rows.filter((row) => matchesFilter(row, 'LOW_CREDIT')).length,
    }),
    [data.rows],
  );
  const visibleRows = useMemo(
    () => data.rows.filter((row) => matchesFilter(row, filter)),
    [data.rows, filter],
  );
  const atLimit = selected.size >= ABNORMAL_BATCH_REMOVE_LIMIT;
  const selectableCount = Math.min(visibleRows.length, ABNORMAL_BATCH_REMOVE_LIMIT);
  const pending = groupAdmin.pendingUserID !== null;

  const handleToggle = useCallback((userId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < ABNORMAL_BATCH_REMOVE_LIMIT) next.add(userId);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelected((current) =>
      current.size >= selectableCount
        ? new Set()
        : new Set(visibleRows.slice(0, ABNORMAL_BATCH_REMOVE_LIMIT).map((row) => row.member.userId)),
    );
  }, [selectableCount, visibleRows]);

  const handleChangeDays = useCallback((days: AbnormalInactiveDays) => {
    setSelected(new Set());
    setInactiveDays(days);
  }, []);

  const handleChangeFilter = useCallback((next: AbnormalReasonFilter) => {
    setSelected(new Set());
    setFilter(next);
  }, []);

  const handleRemove = useCallback(() => {
    const targets = data.rows
      .filter((row) => selected.has(row.member.userId))
      .map((row) => row.member);
    groupAdmin.kickBatch(targets);
  }, [data.rows, groupAdmin, selected]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: { backgroundColor: colors.surface },
      emptyTitle: { color: colors.text },
      emptyHint: { color: colors.textSecondary },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AbnormalMemberRow; index: number }) => (
      <View
        style={[
          s.card,
          d.card,
          index === 0 ? s.cardFirst : null,
          index === visibleRows.length - 1 ? s.cardLast : null,
        ]}
      >
        {index > 0 ? <Divider /> : null}
        <AbnormalMemberItem
          row={item}
          inactiveDays={inactiveDays}
          selected={selected.has(item.member.userId)}
          disabled={atLimit || pending}
          onToggle={handleToggle}
        />
      </View>
    ),
    [atLimit, d.card, handleToggle, inactiveDays, pending, selected, visibleRows.length],
  );

  const header = (
    <AbnormalMembersHeader
      filter={filter}
      counts={counts}
      onFilterChange={handleChangeFilter}
      inactiveDays={inactiveDays}
      onInactiveDaysChange={handleChangeDays}
      creditThreshold={data.creditThreshold}
    />
  );

  let body: React.ReactNode;
  if (data.loading && data.rows.length === 0) {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (data.error) {
    body = (
      <View style={s.center}>
        <Text style={[s.emptyTitle, d.emptyTitle]}>
          {t('chat.groupManagement.abnormal.loadFailed')}
        </Text>
        <Pressable style={[s.retry, d.retry]} onPress={() => void data.reload()} accessibilityRole="button">
          <Text style={d.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={visibleRows}
        keyExtractor={(row) => row.member.userId}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={s.center}>
            <Ionicons name="shield-checkmark-outline" size={40} color={colors.textSecondary} />
            <Text style={[s.emptyTitle, d.emptyTitle]}>{t('chat.groupManagement.abnormal.empty')}</Text>
            <Text style={[s.emptyHint, d.emptyHint]}>{t('chat.groupManagement.abnormal.emptyHint')}</Text>
          </View>
        }
        contentContainerStyle={s.list}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
      />
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.groupManagement.abnormal.title')} />
      {body}
      {!data.error && data.rows.length > 0 ? (
        <AbnormalMembersActionBar
          selectedCount={selected.size}
          selectableCount={selectableCount}
          limit={ABNORMAL_BATCH_REMOVE_LIMIT}
          pending={pending}
          bottomInset={insets.bottom}
          onToggleAll={handleToggleAll}
          onRemove={handleRemove}
        />
      ) : null}
    </View>
  );
}

