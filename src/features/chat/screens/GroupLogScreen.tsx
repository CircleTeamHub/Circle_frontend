import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { fetchChatGroupEvents } from '@/chat-core/api';
import { groupEventText } from '@/chat-core/group-events';
import type { ChatGroupEventDto, ChatSenderInfo } from '@/chat-core/protocol';
import { useAuthStore } from '@/stores/authStore';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 50;
const EVENT_LABELS: Record<string, string> = {
  'group-created': 'created', 'member-joined': 'joined', 'member-left': 'left',
  'member-removed': 'removed', 'member-role-changed': 'roleChanged',
  'member-silenced': 'silenced', 'member-unsilenced': 'unsilenced',
  'owner-transferred': 'ownerTransferred', 'history-cleared': 'historyCleared',
  'mute-all-changed': 'muteAll', 'policy-changed': 'policy',
  'admission-reviewed': 'application', 'member-banned': 'blacklist',
};

/** Pages can overlap when new events arrive between requests. */
export function mergeGroupLogEntries<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map(entry => entry.id));
  return [...current, ...incoming.filter(entry => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  })];
}

export default function GroupLogScreen() {
  const insets = useSafeAreaInsets();
  const { colors, resolvedMode } = useTheme();
  const positiveText = resolvedMode === 'dark' ? colors.success : '#15803D';
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationID?: string; title?: string }>();
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const epoch = useAuthStore(state => state.sessionEpoch);
  const userId = useAuthStore(state => state.user?.id);
  const [draft, setDraft] = useState('');
  const [person, setPerson] = useState<'target' | 'actor'>('target');
  const [search, setSearch] = useState({ keyword: '', person: 'target' as 'target' | 'actor' });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [entries, setEntries] = useState<ChatGroupEventDto[]>([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const pagingRef = useRef(false);
  const failedCursorRef = useRef<string | null>(null);
  const key = `${epoch}:${userId ?? ''}:${conversationID}:${search.person}:${search.keyword}`;
  const visibleEntries = loadedKey === key ? entries : [];

  const loadFirstPage = useCallback(async () => {
    const generation = ++generationRef.current;
    pagingRef.current = true;
    cursorRef.current = null;
    failedCursorRef.current = null;
    setEntries([]); setHasMore(false); setLoadingMore(false); setMoreError(false); setError(false);
    if (!conversationID) { setLoading(false); setError(true); pagingRef.current = false; return; }
    setLoading(true);
    try {
      const page = await fetchChatGroupEvents(conversationID, { limit: PAGE_SIZE, ...(search.keyword ? { keyword: search.keyword, person: search.person } : {}) });
      if (generation !== generationRef.current) return;
      cursorRef.current = page.nextCursor;
      setEntries(page.events.filter(entry => EVENT_LABELS[entry.kind]));
      setLoadedKey(key);
      setHasMore(page.nextCursor !== null);
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setError(true);
      reportHandledFailure('groupLog', 'load', cause);
    } finally {
      if (generation === generationRef.current) { setLoading(false); pagingRef.current = false; }
    }
  }, [conversationID, key, search]);

  useEffect(() => {
    void loadFirstPage();
    return () => { generationRef.current += 1; };
  }, [loadFirstPage]);

  const loadMore = async (retry = false) => {
    const cursor = cursorRef.current;
    if (!conversationID || !hasMore || !cursor || pagingRef.current || (!retry && failedCursorRef.current === cursor)) return;
    const generation = generationRef.current;
    pagingRef.current = true; setLoadingMore(true); setMoreError(false);
    try {
      const page = await fetchChatGroupEvents(conversationID, { limit: PAGE_SIZE, cursor, ...(search.keyword ? { keyword: search.keyword, person: search.person } : {}) });
      if (generation !== generationRef.current) return;
      cursorRef.current = page.nextCursor === cursor ? null : page.nextCursor;
      setHasMore(cursorRef.current !== null);
      setEntries(current => mergeGroupLogEntries(current, page.events.filter(entry => EVENT_LABELS[entry.kind])));
      failedCursorRef.current = null;
    } catch (cause) {
      if (generation !== generationRef.current) return;
      failedCursorRef.current = cursor; setMoreError(true);
      reportHandledFailure('groupLog', 'loadMore', cause);
    } finally {
      if (generation === generationRef.current) { pagingRef.current = false; setLoadingMore(false); }
    }
  };

  const renderPerson = (member: ChatSenderInfo) => {
    const name = member.alias?.trim() || member.nickname.trim() || t('groupReview.unknownMember');
    return <View key={member.id} style={s.person}>
      <Avatar size={30} uri={member.avatarUrl ?? undefined} name={name} identityKey={member.id} />
      <MemberName name={name} userId={member.id} numberOfLines={2} style={[s.personName, { color: colors.text }]} />
    </View>;
  };
  const row = (label: string, value: React.ReactNode) => <View key={label} style={[s.detailRow, { borderTopColor: colors.surfaceBorder }]}>
    <Text style={[s.label, { color: colors.text }]}>{t(`groupLog.${label}`)}</Text><View style={s.value}>{value}</View>
  </View>;
  const searchNow = () => setSearch({ keyword: draft.trim(), person });

  return <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
    <NavHeader title={t('chat.groupLog')} />
    {typeof params.title === 'string' && params.title ? <Text numberOfLines={1} style={[s.subtitle, { color: colors.textSecondary }]}>{params.title}</Text> : null}
    <View style={[s.search, { backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('groupLog.searchRole')} onPress={() => setPickerVisible(true)} style={s.role}>
        <Text style={[Typography.bodyRegular, { color: colors.text }]}>{t(`groupLog.${person}`)}</Text><Ionicons name="caret-down" size={12} color={colors.text} />
      </Pressable>
      <TextInput testID="group-log-search" value={draft} onChangeText={setDraft} onSubmitEditing={searchNow} accessibilityLabel={t('groupReview.searchPlaceholder')}
        placeholder={t('groupReview.searchPlaceholder')} placeholderTextColor={colors.textSecondary} maxLength={64} returnKeyType="search" style={[s.searchInput, { color: colors.text }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.search')} onPress={searchNow} style={[s.searchButton, { backgroundColor: colors.primary }]}>
        <Text style={[Typography.small, { color: colors.white }]}>{t('common.search')}</Text>
      </Pressable>
    </View>
    {loading ? <View style={s.center}><ActivityIndicator color={colors.primary} /></View> : error ? <View style={s.center}>
      <Text style={{ color: colors.textSecondary }}>{t('chat.groupLogLoadFailed')}</Text>
      <Pressable accessibilityRole="button" style={s.retry} onPress={() => void loadFirstPage()}><Text style={{ color: colors.primary }}>{t('common.retry')}</Text></Pressable>
    </View> : <FlatList testID="group-log-list" data={visibleEntries} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={visibleEntries.length ? [s.content, { paddingBottom: insets.bottom + 16 }] : s.center}
      ListEmptyComponent={<Text style={{ color: colors.textSecondary }}>{t('chat.noGroupLog')}</Text>}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : moreError ? <Pressable accessibilityRole="button" style={s.retry} onPress={() => void loadMore(true)}><Text style={{ color: colors.primary }}>{t('common.retry')}</Text></Pressable> : null}
      onEndReached={() => void loadMore()} onEndReachedThreshold={0.3}
      renderItem={({ item }) => {
        const isRemoval = item.kind === 'member-removed' || item.kind === 'member-banned';
        const isJoin = item.kind === 'member-joined' || item.kind === 'admission-reviewed';
        const operator = item.review?.operator ?? item.actor;
        return <View style={[s.card, { backgroundColor: colors.surface }]}>
          <View style={s.cardHeader}>
            <Text style={[s.action, { color: isRemoval ? colors.danger : isJoin ? positiveText : colors.text }]}>{t(`groupLog.events.${EVENT_LABELS[item.kind]}`)}</Text>
            <View style={s.targets}>{item.targets.map(renderPerson)}</View>
          </View>
          {row('date', <Text style={[s.valueText, { color: colors.text }]}>{new Date(item.createdAt).toLocaleString()}</Text>)}
          {item.review ? <>
            {row('status', <Text style={[s.valueText, { color: item.review.blacklisted || item.review.status === 'REJECTED' ? colors.danger : positiveText }]}>{t(`groupReview.status.${item.review.blacklisted ? 'BLACKLISTED' : item.review.status}`)}</Text>)}
            {row('source', <Text style={[s.valueText, { color: colors.text }]}>{t(`groupReview.source.${item.review.source}`)}</Text>)}
            {item.review.inviter ? row('inviter', renderPerson(item.review.inviter)) : null}
          </> : null}
          {operator ? row('operator', renderPerson(operator)) : null}
          {!['member-joined', 'member-left', 'member-removed', 'admission-reviewed', 'member-banned', 'group-created'].includes(item.kind)
            ? row('detail', <Text style={[s.valueText, { color: colors.textSecondary }]}>{groupEventText(item)}</Text>) : null}
        </View>;
      }} />}
    <OptionPickerSheet visible={pickerVisible} title={t('groupLog.searchRole')} selectedValue={person}
      options={[{ value: 'target' as const, label: t('groupLog.target') }, { value: 'actor' as const, label: t('groupLog.actor') }]}
      onSelect={setPerson} onClose={() => setPickerVisible(false)} />
  </View>;
}

const s = StyleSheet.create({
  container: { flex: 1 }, subtitle: { ...Typography.small, textAlign: 'center', marginBottom: 12, paddingHorizontal: 16 },
  search: { margin: 12, borderRadius: Radius.full, paddingLeft: 12, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  role: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  searchInput: { ...Typography.bodyRegular, flex: 1, minWidth: 0, paddingVertical: 10 },
  searchButton: { paddingHorizontal: 12, minHeight: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 9, gap: 9 }, card: { borderRadius: 6, paddingHorizontal: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 48 },
  action: { ...Typography.body, flexShrink: 1, maxWidth: '40%' }, targets: { flex: 1, alignItems: 'flex-end', gap: 6 },
  person: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, maxWidth: '100%' }, personName: { ...Typography.body, flexShrink: 1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, minHeight: 40, borderTopWidth: StyleSheet.hairlineWidth },
  label: { ...Typography.bodyRegular, flexShrink: 1 }, value: { flex: 1, alignItems: 'flex-end' }, valueText: { ...Typography.bodyRegular, textAlign: 'right' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg }, retry: { alignItems: 'center', padding: Spacing.md },
});
