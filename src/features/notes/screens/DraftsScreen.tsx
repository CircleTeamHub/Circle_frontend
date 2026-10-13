import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import { fetchNoteDrafts, deleteNoteDraft } from '@/services/api/notes';
import type { NoteDraftSummary } from '@/features/notes/types';
import {
  loadLocalNoteDraftSummaries,
  hasLocalNoteDraftPendingSubmission,
  stageLocalNoteDraftDeletion,
  finishLocalNoteDraftDeletion,
  confirmNoteDraftDeletion,
  isLocalNoteDraftDeleted,
  loadPendingNoteDraftDeletions,
  type NoteLocalDraftSummary,
} from '@/features/notes/utils/note-editor-drafts';
import { formatNoteDate } from '@/features/notes/utils/note-format';
import { Spacing, Typography, useTheme } from '@/theme';

type DraftListItem = NoteLocalDraftSummary & { synced: boolean };

function mergeDrafts(
  local: NoteLocalDraftSummary[],
  remote: NoteDraftSummary[],
): DraftListItem[] {
  const byId = new Map<string, DraftListItem>();
  for (const item of local) byId.set(item.id, { ...item, synced: false });
  for (const item of remote) {
    const remoteItem: DraftListItem = {
      id: item.id,
      noteId: item.sourceNoteId ?? null,
      title: item.title,
      contentPreview: item.contentPreview ?? '',
      mediaCount: item.mediaCount,
      createdAt: Date.parse(item.createdAt) || Date.now(),
      updatedAt: Date.parse(item.updatedAt) || Date.now(),
      synced: true,
    };
    const current = byId.get(item.id);
    if (!current || remoteItem.updatedAt >= current.updatedAt) {
      byId.set(item.id, remoteItem);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

// Android 旧架构需显式开启 LayoutAnimation（iOS 与新架构默认可用）。
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function DraftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.user?.id);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const sessionKey = `${userId ?? 'anonymous'}:${sessionEpoch}`;
  const loadedSessionRef = useRef('');
  const loadGenerationRef = useRef(0);
  const deletionRunRef = useRef(new Set<string>());
  const isCurrentSession = useCallback(() => {
    const auth = useAuthStore.getState();
    return auth.user?.id === userId && auth.sessionEpoch === sessionEpoch;
  }, [userId, sessionEpoch]);
  const [items, setItems] = useState<DraftListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0);
  const mountedRef = useRef(true);

  const retryDeletions = useCallback(async () => {
    if (!userId || !isCurrentSession() || deletionRunRef.current.has(sessionKey)) return;
    deletionRunRef.current.add(sessionKey);
    const attempted = new Set<string>();
    // Deliberately serial: a failed/offline request must not create a burst of DELETEs.
    try { while (true) {
      if (!isCurrentSession()) return;
      const id = loadPendingNoteDraftDeletions(userId).find((candidate) => !attempted.has(candidate));
      if (!id) return;
      attempted.add(id);
      try {
        const cleanedRecordings = await finishLocalNoteDraftDeletion(userId, id);
        if (!isCurrentSession()) return;
        await deleteNoteDraft(id);
        if (!isCurrentSession()) return;
        confirmNoteDraftDeletion(userId, id, cleanedRecordings);
      } catch {
        // Content is already hidden; the durable queue retains cleanup and DELETE for retry.
      } finally {
        if (mountedRef.current && isCurrentSession()) setPendingDeleteCount(loadPendingNoteDraftDeletions(userId).length);
      }
    } } finally {
      deletionRunRef.current.delete(sessionKey);
      // 队列为空（含换账号后新会话本来就没有待删项）时也要落一次真实计数，
      // 不能让上一个会话失败留下的提示条挂到当前会话上。
      if (mountedRef.current && isCurrentSession()) setPendingDeleteCount(loadPendingNoteDraftDeletions(userId).length);
    }
  }, [userId, isCurrentSession, sessionKey]);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    // 换了账号/会话：上一个会话的待删提示立即清掉，新会话的计数等 retryDeletions 落定。
    if (loadedSessionRef.current !== sessionKey) setPendingDeleteCount(0);
    loadedSessionRef.current = sessionKey;
    const local = userId ? loadLocalNoteDraftSummaries(userId) : [];
    setItems(mergeDrafts(local, []));
    // 待删队列的提示同样等本次重试的结果再显示（见 retryDeletions），避免进页面先闪一下。
    setLoading(false);
    if (!userId || !isCurrentSession()) return;
    void retryDeletions();
    try {
      const remote = await fetchNoteDrafts();
      if (mountedRef.current && generation === loadGenerationRef.current && isCurrentSession()) {
        setItems(mergeDrafts(loadLocalNoteDraftSummaries(userId), remote.filter((item) => !isLocalNoteDraftDeleted(userId, item.id))));
      }
    } catch {
      // Local drafts remain available while offline; the next focus retries sync.
    }
  }, [userId, sessionKey, isCurrentSession, retryDeletions]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      void load();
      return () => {
        mountedRef.current = false;
        loadGenerationRef.current += 1;
      };
    }, [load]),
  );

  const openDraft = useCallback(
    (item: DraftListItem) => {
      if (!isCurrentSession() || loadedSessionRef.current !== sessionKey || isLocalNoteDraftDeleted(userId, item.id)) return;
      router.push({
        pathname: '/(tabs)/profile/notes/edit',
        params: {
          draftId: item.id,
          ...(item.noteId ? { id: item.noteId } : {}),
        },
      } as never);
    },
    [router, isCurrentSession, sessionKey, userId],
  );

  const performDelete = useCallback(
    (item: DraftListItem, discardPendingSubmission: boolean) => {
      if (!isCurrentSession() || !userId || loadedSessionRef.current !== sessionKey) return;
      loadGenerationRef.current += 1;
      try {
        // Check the latest durable record, not the possibly stale list summary.
        if (!stageLocalNoteDraftDeletion(userId, item.id, [], { discardPendingSubmission })) {
          // 确认框弹出后草稿才挂上「未确认」标记（另一处正在提交）：不静默删，让用户重新确认。
          Alert.alert(t('common.errorOccurred'), t('notes.drafts.pendingSubmitDeleteBlocked'));
          return;
        }
        // 卡片淡出、下面的卡片顺势上移，而不是瞬间消失。
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setItems((current) => current.filter((draft) => draft.id !== item.id));
        // 「同步未完成」提示只在服务端删除真的失败后由 retryDeletions 显示；这里不提前置位，
        // 否则每删一个都会闪出提示条、把列表往下推一下，删除成功后又立刻消失。
        void retryDeletions();
      } catch {
        if (isLocalNoteDraftDeleted(userId, item.id)) setItems((current) => current.filter((draft) => draft.id !== item.id));
        setPendingDeleteCount(loadPendingNoteDraftDeletions(userId).length);
        Alert.alert(t('common.errorOccurred'), t('notes.drafts.deleteFailed'));
      }
    },
    [t, userId, isCurrentSession, sessionKey, retryDeletions],
  );

  const removeDraft = useCallback(
    (item: DraftListItem) => {
      // 带「提交结果未确认」标记的草稿不再一律拒删：明确提示可能丢内容，由用户决定。
      // 服务端回过笔记但内容不一致也按未确认处理（回来的笔记可能不完整）。
      const pending = userId ? hasLocalNoteDraftPendingSubmission(userId, item.id) : false;
      Alert.alert(
        t('notes.drafts.deleteTitle', { defaultValue: '删除草稿？' }),
        pending
          ? t('notes.drafts.deleteUnconfirmedMessage')
          : t('notes.drafts.deleteMessage', { defaultValue: '删除后无法恢复。' }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: pending
              ? t('notes.drafts.deleteAnyway')
              : t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: () => performDelete(item, pending),
          },
        ],
      );
    },
    [t, userId, performDelete],
  );

  const empty = useMemo(
    () => (
      <View style={s.empty}>
        <Ionicons name="document-text-outline" size={42} color={colors.textSecondary} />
        <Text style={[s.emptyText, { color: colors.textSecondary }]}> 
          {t('notes.drafts.empty', { defaultValue: '草稿箱是空的' })}
        </Text>
      </View>
    ),
    [colors.textSecondary, t],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}> 
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Ionicons name="chevron-back" size={25} color={colors.text} />
        </Pressable>
        <Text style={[s.title, { color: colors.text }]}> 
          {t('notes.drafts.title', { defaultValue: '草稿箱' })}
        </Text>
        <View style={s.headerSpacer} />
      </View>
      {loadedSessionRef.current === sessionKey && pendingDeleteCount > 0 ? (
        <View style={s.deletePending}>
          <Text style={[s.preview, { color: colors.textSecondary }]}>{t('notes.drafts.deletePending', { defaultValue: '删除清理或服务器同步尚未完成。内容已隐藏，请重试完成删除。' })}</Text>
          <Pressable onPress={() => void retryDeletions()} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <Text style={{ color: colors.primary }}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {loading && items.length === 0 ? (
        <ActivityIndicator style={s.loading} color={colors.primary} />
      ) : (
        <FlatList
          data={loadedSessionRef.current === sessionKey ? items : []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[s.list, items.length === 0 && s.emptyList, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <Pressable
              style={[s.card, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
              onPress={() => openDraft(item)}
              accessibilityRole="button"
            >
              <View style={s.cardBody}>
                <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.title.trim() || t('notes.drafts.untitled')}
                </Text>
                <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={2}>
                  {item.contentPreview || t('notes.drafts.noContent')}
                </Text>
                <Text style={[s.meta, { color: colors.textSecondary }]}> 
                  {formatNoteDate(new Date(item.updatedAt).toISOString())}
                  {item.mediaCount > 0 ? ` · ${t('notes.drafts.mediaCount', { count: item.mediaCount })}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={(event) => {
                  event?.stopPropagation();
                  removeDraft(item);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('notes.drafts.deleteLabel')}
              >
                <Ionicons name="trash-outline" size={21} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 62,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...Typography.h2, fontWeight: '700' },
  headerSpacer: { width: 25 },
  deletePending: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm },
  list: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  emptyList: { flexGrow: 1 },
  loading: { marginTop: Spacing.xl },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    minHeight: 118,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cardBody: { flex: 1, gap: 5 },
  cardTitle: { ...Typography.body, fontWeight: '700' },
  preview: { ...Typography.bodyRegular, lineHeight: 20 },
  meta: { ...Typography.caption },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  emptyText: { ...Typography.body },
});
