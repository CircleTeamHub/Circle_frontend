import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteSummary } from '@/features/notes/types';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import {
  applyNoteSourceStatusToSummaries,
  withNoteSyncRetry,
} from '@/features/notes/utils/note-sync';
import { deleteNote, fetchNotes, relistNote } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const keyExtractor = (item: NoteSummary) => item.id;

export default function UnlistedNotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuNote, setMenuNote] = useState<NoteSummary | null>(null);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const noteStatusVersion = useNoteStatusSignalStore((state) => state.version);
  const noteStatusChange = useNoteStatusSignalStore((state) => state.lastChange);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!noteStatusChange) return;
    setNotes((current) =>
      applyNoteSourceStatusToSummaries(current, noteStatusChange),
    );
  }, [noteStatusChange]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    try {
      const notesData = await withNoteSyncRetry(() =>
        fetchNotes({ status: 'UNLISTED' }),
      );
      if (!mountedRef.current || sequence !== loadSequenceRef.current) return;
      setNotes(notesData);
      setLoadError(false);
      setLoading(false);
    } catch (error) {
      if (!mountedRef.current || sequence !== loadSequenceRef.current) return;
      throw error;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Re-run the focus loader when a realtime source-status signal advances.
      void noteStatusVersion;
      setLoading(true);
      void load().catch(() => {
        if (mountedRef.current) {
          setLoadError(true);
          setLoading(false);
        }
      });
    }, [load, noteStatusVersion]),
  );

  const handleRefreshNotes = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await load();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [load]);

  const openNote = useCallback(
    (note: NoteSummary) =>
      router.push({
        pathname: '/(tabs)/profile/notes/[id]',
        params: { id: note.id, ownerId: note.ownerId ?? '' },
      } as never),
    [router],
  );

  const closeMenu = useCallback(() => setMenuNote(null), []);

  // 上架/删除已在服务端成功：这行一定离开「已下架」列表。先本地移除（真实且乐观），
  // 再刷新；刷新失败不能再报「上架/删除失败」，否则用户会对已成功的操作反复重试。
  // load() 自带序号，会作废在飞的旧刷新（其响应还包含这一行）。
  const removeSettledNote = useCallback(
    (noteId: string) => {
      if (!mountedRef.current) return;
      setNotes((current) => current.filter((item) => item.id !== noteId));
      void load().catch(() => {
        // 列表下次 focus / 下拉时自然重试
      });
    },
    [load],
  );

  const handleRelistNote = useCallback(async () => {
    const note = menuNote;
    if (!note) return;
    closeMenu();
    try {
      await relistNote(note.id);
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          t('notes.alerts.relistFailedTitle', { defaultValue: '上架失败' }),
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        );
      }
      return;
    }
    removeSettledNote(note.id);
  }, [closeMenu, menuNote, removeSettledNote, t]);

  // 删除是软删除：笔记进回收站（30 天后自动清除），与「我的笔记」列表的删除同一个接口。
  const handleDeleteNote = useCallback(() => {
    const note = menuNote;
    if (!note) return;
    closeMenu();
    Alert.alert(
      t('notes.alerts.deleteTitle', { defaultValue: '删除笔记' }),
      t('notes.alerts.deleteConfirm', {
        defaultValue: '删除后可在回收站找回，30 天后自动清除。',
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('notes.actions.delete', { defaultValue: '删除' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteNote(note.id);
            } catch {
              if (mountedRef.current) {
                Alert.alert(
                  t('notes.alerts.deleteFailedTitle', { defaultValue: '删除失败' }),
                  t('common.retryLater', { defaultValue: '请稍后重试' }),
                );
              }
              return;
            }
            removeSettledNote(note.id);
          },
        },
      ],
    );
  }, [closeMenu, menuNote, removeSettledNote, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      hint: { color: colors.text },
      actionText: { color: colors.text },
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      sheetAction: { color: colors.iconAccent },
      sheetDanger: { color: colors.danger },
    }),
    [colors],
  );

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard note={item} onPress={openNote} onMorePress={setMenuNote} />
    ),
    [openNote],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <Text style={[s.pageTitle, d.title]}>
        {t('notes.unlistedTitle', { defaultValue: '已下架笔记' })}
      </Text>
      <Text style={[s.hint, d.hint]}>
        {t('notes.unlistedAutoDeleteHint', {
          defaultValue: '已下架笔记不会自动删除，可随时重新上架。',
        })}
      </Text>

      <FlatList
        data={notes}
        keyExtractor={keyExtractor}
        renderItem={renderNote}
        contentContainerStyle={{
          paddingTop: Spacing.md,
          paddingBottom: insets.bottom + Spacing.xl,
          gap: Spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
        refreshing={refreshing}
        onRefresh={handleRefreshNotes}
        ListEmptyComponent={
          loading ? null : loadError ? (
            <View style={s.emptyWrap}>
              <Text style={[s.emptyText, d.hint]}>
                {t('notes.loadFailed', {
                  defaultValue: '笔记加载失败，请检查网络后重试',
                })}
              </Text>
              <Pressable
                style={[s.retryBtn, { backgroundColor: colors.primary }]}
                onPress={() => void handleRefreshNotes()}
              >
                <Text style={[s.retryText, { color: colors.white }]}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.emptyText, d.hint]}>
              {t('notes.empty.noUnlisted', { defaultValue: '暂无已下架笔记' })}
            </Text>
          )
        }
      />

      <BottomSheetModal
        visible={menuNote != null}
        onClose={closeMenu}
        backdropStyle={d.backdrop}
        sheetStyle={[
          s.sheet,
          d.sheet,
          { paddingBottom: insets.bottom || Spacing.lg },
        ]}
      >
        <View style={[s.handle, d.handle]} />
        {menuNote ? (
          <Text style={[s.sheetTitle, d.hint]} numberOfLines={1}>
            {menuNote.title}
          </Text>
        ) : null}
        <Pressable
          style={s.sheetRow}
          onPress={() => void handleRelistNote()}
          accessibilityRole="button"
          accessibilityLabel={t('notes.actions.relist', {
            defaultValue: '上架',
          })}
        >
          <Ionicons name="cloud-upload-outline" size={20} color={colors.iconAccent} />
          <Text style={[s.sheetLabel, d.sheetAction]}>
            {t('notes.actions.relist', { defaultValue: '上架' })}
          </Text>
        </Pressable>
        <Pressable
          style={s.sheetRow}
          onPress={handleDeleteNote}
          accessibilityRole="button"
          accessibilityLabel={t('notes.actions.delete', { defaultValue: '删除' })}
        >
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={[s.sheetLabel, d.sheetDanger]}>
            {t('notes.actions.delete', { defaultValue: '删除' })}
          </Text>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  header: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  pageTitle: { ...Typography.h1, marginTop: Spacing.xs },
  hint: { ...Typography.small, marginTop: Spacing.xs },
  emptyWrap: { alignItems: 'center', gap: Spacing.md },
  emptyText: {
    textAlign: 'center',
    paddingTop: Spacing.xl,
    ...Typography.bodyRegular,
  },
  retryBtn: {
    paddingHorizontal: Spacing.lg,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { ...Typography.caption, fontWeight: '600' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  sheetTitle: {
    ...Typography.caption,
    fontWeight: '400',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 54,
  },
  sheetLabel: { ...Typography.body },
});
