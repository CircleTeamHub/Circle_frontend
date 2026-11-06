import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { NavHeader } from '@/components/ui/nav-header';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { getGroupLogHref, getUserProfileScopeFromSegments } from '@/features/user/utils/routes';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { groupOrCircleMutatedSince } from '@/features/chat/utils/group-reload-key';
import { useAuthStore } from '@/stores/authStore';
import { actOnGroupReviews, fetchGroupReviews, type GroupReviewAction, type GroupReviewItem, type GroupReviewPage } from '@/services/api/group-reviews';
import { markCircleWrite } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const MAX_SELECTION = 50;
type OwnedPage = GroupReviewPage & { key: string };

export default function GroupReviewScreen() {
  const { colors, resolvedMode } = useTheme();
  const positiveText = resolvedMode === 'dark' ? colors.success : '#15803D';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const scope = getUserProfileScopeFromSegments(useSegments());
  const params = useLocalSearchParams<{ conversationID?: string; title?: string }>();
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const userId = useAuthStore(state => state.user?.id);
  const sessionEpoch = useAuthStore(state => state.sessionEpoch);
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState<OwnedPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const paging = useRef(false);
  const failedCursor = useRef<string | null>(null);
  const operation = useRef<symbol | null>(null);
  const key = `${sessionEpoch}:${userId ?? ''}:${conversationID}:${keyword}`;
  const visible = page?.key === key ? page : null;
  const items = visible?.items ?? [];
  const groupTitle = visible?.group.name || (typeof params.title === 'string' ? params.title : '');
  const gate = useFocusReloadGate({ key, mutatedSince: groupOrCircleMutatedSince });

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(draft.trim()), 250);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    operation.current = null;
    setBusy(false);
    setSelected(new Set());
    setStatus('');
    return () => { operation.current = null; };
  }, [conversationID, sessionEpoch, userId]);

  const load = useCallback(async (cursor?: string) => {
    if (!conversationID) { setLoading(false); setError(t('groupReview.loadFailed')); return; }
    if (cursor && paging.current) return;
    const version = cursor ? generation.current : ++generation.current;
    if (cursor) { paging.current = true; setLoadingMore(true); }
    else { paging.current = true; setLoading(true); setSelected(new Set()); }
    setError('');
    const startedAt = Date.now();
    try {
      const result = await fetchGroupReviews(conversationID, { ...(cursor ? { cursor } : {}), keyword });
      if (version !== generation.current || useAuthStore.getState().sessionEpoch !== sessionEpoch || useAuthStore.getState().user?.id !== userId) return;
      setPage(current => {
        const previous = cursor && current?.key === key ? current.items : [];
        const ids = new Set(previous.map(item => item.id));
        return { ...result, key, nextCursor: result.nextCursor === cursor ? null : result.nextCursor, items: [...previous, ...result.items.filter(item => !ids.has(item.id))] };
      });
      failedCursor.current = null;
      if (!cursor) gate.markLoaded(startedAt);
    } catch (cause) {
      if (version !== generation.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      failedCursor.current = cursor ?? null;
      setError(getApiErrorMessage(cause, t('groupReview.loadFailed')));
      reportHandledFailure('groupAdmission', 'reviewList', cause);
    } finally {
      if (version === generation.current) { paging.current = false; setLoading(false); setLoadingMore(false); }
    }
  }, [conversationID, gate, key, keyword, sessionEpoch, t, userId]);
  useFocusEffect(useCallback(() => {
    if (!gate.shouldSkip()) void load();
    return () => { generation.current++; paging.current = false; };
  }, [gate, load]));

  const pending = items.filter(item => item.status === 'PENDING');
  const toggle = (item: GroupReviewItem) => {
    if (busy || item.status !== 'PENDING') return;
    if (!selected.has(item.id) && selected.size >= MAX_SELECTION) { Alert.alert(t('groupReview.entry'), t('groupReview.selectionLimit')); return; }
    setSelected(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
  };
  const selectAll = () => {
    if (busy) return;
    if (selected.size) { setSelected(new Set()); return; }
    setSelected(new Set(pending.slice(0, MAX_SELECTION).map(item => item.id)));
    if (pending.length > MAX_SELECTION) Alert.alert(t('groupReview.entry'), t('groupReview.selectionLimit'));
  };
  const run = async (action: GroupReviewAction, ids: string[]) => {
    if (operation.current || !ids.length) return;
    const token = Symbol(action);
    operation.current = token;
    setBusy(true);
    setStatus('');
    try {
      const promise = actOnGroupReviews(conversationID, ids, action);
      const result = await (visible?.group.circleId ? markCircleWrite(promise) : promise);
      if (operation.current !== token || useAuthStore.getState().sessionEpoch !== sessionEpoch || useAuthStore.getState().user?.id !== userId) return;
      const succeeded = new Set(result.results.filter(item => item.ok).map(item => item.id));
      const failures = result.results.filter(item => !item.ok);
      setPage(current => current?.key === key ? { ...current, items: current.items.map(item => succeeded.has(item.id)
        ? { ...item, status: action === 'approve' ? 'JOINED' : action === 'blacklist' ? 'BLACKLISTED' : 'REJECTED' } : item) } : current);
      setSelected(new Set(failures.map(item => item.id)));
      setStatus(failures.length
        ? t('groupReview.partialResult', { succeeded: succeeded.size, failed: failures.length })
        : t('groupReview.completed', { count: succeeded.size }));
    } catch (cause) {
      if (operation.current !== token || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      setStatus(getApiErrorMessage(cause, t('groupReview.actionUncertain')));
      reportHandledFailure('groupAdmission', 'reviewAction', cause);
    } finally {
      if (operation.current === token) { operation.current = null; setBusy(false); }
    }
  };
  const confirm = (action: GroupReviewAction) => {
    if (busy || !selected.size) return;
    const ids = pending.filter(item => selected.has(item.id)).map(item => item.id);
    if (!ids.length) return;
    Alert.alert(t(`groupReview.confirm.${action}`), t(action === 'blacklist' ? 'groupReview.blacklistBody' : 'groupReview.confirmBody', { count: ids.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t(`groupReview.${action}`), style: action === 'approve' ? 'default' : 'destructive', onPress: () => run(action, ids) },
    ]);
  };

  return <KeyboardAvoidingContainer style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
    <NavHeader title={t('groupReview.title')} rightSlot={
      <Pressable accessibilityRole="button" accessibilityLabel={t('groupReview.log')} disabled={busy}
        onPress={() => router.push(getGroupLogHref(scope, { conversationID, title: groupTitle || undefined }))} hitSlop={8}>
        <Text style={[Typography.body, { color: colors.text }]}>{t('groupReview.log')}</Text>
      </Pressable>
    } />
    {groupTitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textSecondary }]}>{groupTitle}</Text> : null}
    <View style={styles.body}>
      <View style={[styles.search, { backgroundColor: colors.surface }]}>
        <Ionicons name="search" size={22} color={colors.text} />
        <TextInput testID="group-review-search" accessibilityLabel={t('groupReview.searchPlaceholder')}
          value={draft} onChangeText={setDraft} onSubmitEditing={() => setKeyword(draft.trim())}
          placeholder={t('groupReview.searchPlaceholder')} placeholderTextColor={colors.textSecondary} returnKeyType="search" maxLength={64}
          editable={!busy} style={[styles.searchInput, { color: colors.text }]} />
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={t('groupReview.selectAll')}
        accessibilityState={{ checked: selected.size ? (selected.size === pending.length ? true : 'mixed') : false, disabled: busy || !pending.length }}
        disabled={busy || !pending.length} onPress={selectAll} style={styles.selectAll}>
        <Ionicons name={selected.size ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected.size ? colors.primary : colors.textSecondary} />
        <Text style={[Typography.bodyRegular, { color: colors.text }]}>{t('groupReview.selectAll')}</Text>
      </Pressable>
      {status ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.textSecondary }]}>{status}</Text> : null}
      {error && items.length ? <Text style={[styles.feedback, { color: colors.danger }]}>{error}</Text> : null}
      <FlatList testID="group-review-list" style={styles.list} data={items} keyExtractor={item => item.id}
        {...keyboardDismissOnDragProps}
        contentContainerStyle={items.length ? styles.listContent : styles.center}
        refreshing={loading && items.length > 0} onRefresh={() => { if (!busy) void load(); }}
        onEndReached={() => { if (!busy && visible?.nextCursor && visible.nextCursor !== failedCursor.current) void load(visible.nextCursor); }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} /> : <View style={styles.empty}>
          <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>{error || t(keyword ? 'groupReview.noResults' : 'groupReview.empty')}</Text>
          {error ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={{ color: colors.primary }}>{t('common.retry')}</Text></Pressable> : null}
        </View>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : error && items.length ?
          <Pressable accessibilityRole="button" onPress={() => void load(failedCursor.current ?? undefined)} style={styles.retry}><Text style={{ color: colors.primary }}>{t('common.retry')}</Text></Pressable> : null}
        renderItem={({ item }) => {
          const name = item.applicant.nickname || item.applicant.accountId || t('groupReview.unknownMember');
          const selectable = item.status === 'PENDING' && !busy;
          const checked = selected.has(item.id);
          return <Pressable testID={`group-review-select-${item.id}`} accessibilityRole="checkbox" accessibilityLabel={t('groupReview.selectApplicant', { name })}
            accessibilityState={{ checked, disabled: !selectable }} disabled={!selectable} onPress={() => toggle(item)}
            style={[styles.row, { borderBottomColor: colors.surfaceBorder }]}>
            <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={checked ? colors.primary : colors.surfaceBorder} />
            <Avatar size={42} uri={item.applicant.avatarUrl ?? undefined} name={name} identityKey={item.applicant.id} />
            <View style={styles.person}>
              <MemberName name={name} userId={item.applicant.id} style={[styles.name, { color: colors.text }]} numberOfLines={1} />
              <Text numberOfLines={1} style={[styles.relationship, { color: positiveText }]}>{item.inviter
                ? t('groupReview.invitedBy', { name: item.inviter.nickname || item.inviter.accountId || t('groupReview.unknownMember') })
                : t(`groupReview.source.${item.source}`)}</Text>
              <Text numberOfLines={2} style={[styles.source, { color: colors.textSecondary }]}>{t('groupReview.sourcePrefix', { source: t(`groupReview.source.${item.source}`) })}{item.reason ? ` · ${item.reason}` : ''}</Text>
            </View>
            <Text numberOfLines={2} style={[styles.status, { color: item.status === 'PENDING' ? colors.link : item.status === 'BLACKLISTED' ? colors.danger : colors.textSecondary }]}>{t(`groupReview.status.${item.status}`)}</Text>
          </Pressable>;
        }} />
    </View>
    <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.surfaceBorder, paddingBottom: insets.bottom + Spacing.sm }]}>
      {(['blacklist', 'reject', 'approve'] as const).map(action => <Pressable key={action} testID={`group-review-${action}`}
        accessibilityRole="button" accessibilityLabel={t(`groupReview.${action}`)} disabled={busy || !selected.size}
        onPress={() => confirm(action)} style={[styles.action, { backgroundColor: action === 'approve' ? colors.primary : action === 'reject' ? colors.dangerFill : '#6B7280', opacity: busy || !selected.size ? 0.45 : 1 }]}>
        <Text numberOfLines={2} style={[styles.actionText, { color: colors.white }]}>{busy ? t('groupReview.processing') : t(`groupReview.${action}`)}</Text>
      </Pressable>)}
    </View>
  </KeyboardAvoidingContainer>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  subtitle: { ...Typography.small, textAlign: 'center', marginTop: -2, marginBottom: 12, paddingHorizontal: Spacing.lg },
  body: { flex: 1, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, overflow: 'hidden', paddingTop: Spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: Spacing.md, borderRadius: Radius.full, minHeight: 44, paddingHorizontal: Spacing.md },
  searchInput: { ...Typography.bodyRegular, flex: 1, minWidth: 0, paddingVertical: 10 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12, marginTop: 8 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 88, borderBottomWidth: StyleSheet.hairlineWidth },
  person: { flex: 1, minWidth: 0, gap: 3 },
  name: { ...Typography.body, fontSize: 16 },
  relationship: { ...Typography.bodyRegular },
  source: { ...Typography.small, lineHeight: 17 },
  status: { ...Typography.small, maxWidth: 64, textAlign: 'right' },
  feedback: { ...Typography.small, paddingHorizontal: Spacing.md, paddingBottom: 8 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  empty: { alignItems: 'center', gap: 8 },
  retry: { alignItems: 'center', padding: Spacing.md },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  action: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 10 },
  actionText: { ...Typography.body, textAlign: 'center', fontSize: 14 },
});
