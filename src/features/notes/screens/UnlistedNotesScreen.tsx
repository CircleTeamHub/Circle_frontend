import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchNotes, relistNote } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const keyExtractor = (item: NoteSummary) => item.id;

const ItemSeparator = memo(function ItemSeparator() {
  const { colors } = useTheme();
  return <View style={[s.divider, { backgroundColor: colors.divider }]} />;
});

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

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    const notesData = await fetchNotes({ status: 'UNLISTED' });
    if (!mountedRef.current) return;
    setNotes(notesData);
    setLoadError(false);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load().catch(() => {
        if (mountedRef.current) {
          setLoadError(true);
          setLoading(false);
        }
      });
    }, [load]),
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

  const handleRelistNote = useCallback(async () => {
    const note = menuNote;
    if (!note) return;
    closeMenu();
    try {
      await relistNote(note.id);
      if (mountedRef.current) await load();
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          t('notes.alerts.relistFailedTitle', { defaultValue: '上架失败' }),
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        );
      }
    }
  }, [closeMenu, load, menuNote, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      hint: { color: colors.textSecondary },
      actionText: { color: colors.text },
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      separator: { backgroundColor: colors.divider },
      primary: { color: colors.primary },
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
          defaultValue: '已下架笔记会在一个月后自动删除。',
        })}
      </Text>

      <FlatList
        data={notes}
        keyExtractor={keyExtractor}
        renderItem={renderNote}
        ItemSeparatorComponent={ItemSeparator}
        contentContainerStyle={{
          paddingTop: Spacing.md,
          paddingBottom: insets.bottom + Spacing.xl,
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
          <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
          <Text style={[s.sheetLabel, d.primary]}>
            {t('notes.actions.relist', { defaultValue: '上架' })}
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
  divider: { height: StyleSheet.hairlineWidth },
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
