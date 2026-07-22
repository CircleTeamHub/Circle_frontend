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
import { fetchDeletedNotes, restoreNote } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const keyExtractor = (item: NoteSummary) => item.id;

const ItemSeparator = memo(function ItemSeparator() {
  const { colors } = useTheme();
  return <View style={[s.divider, { backgroundColor: colors.divider }]} />;
});

/**
 * 回收站（FE#92）：已软删笔记列表 + 恢复。与 UnlistedNotesScreen 同構——
 * 数据来自 GET /note/recycle-bin（后端一直在软删保留数据，这是缺失的读路径）。
 * 恢复后后端置回 ACTIVE。不提供彻底删除：保留语义交给后端保留期策略统一处理。
 */
export default function RecycleBinScreen() {
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
    const notesData = await fetchDeletedNotes();
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

  const handleRefresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await load();
    } catch {
      // round 2 review：下拉刷新/重试失败此前直接外抛（void 调用方 →
      // unhandled rejection），且已有列表下 loadError 恒 false、用户毫无
      // 感知。吞掉异常 + 提示一条轻量报错；已加载的数据原样保留。
      if (mountedRef.current) {
        Alert.alert(
          t('notes.alerts.refreshFailedTitle', { defaultValue: '刷新失败' }),
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        );
      }
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [load, t]);

  const closeMenu = useCallback(() => setMenuNote(null), []);

  const handleRestore = useCallback(async () => {
    const note = menuNote;
    if (!note) return;
    closeMenu();
    try {
      await restoreNote(note.id);
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          t('notes.alerts.restoreFailedTitle', { defaultValue: '恢复失败' }),
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        );
      }
      return;
    }
    // round 2 review：恢复已在服务端成功 —— 之后的列表刷新失败不能再报
    // 「恢复失败」（用户会对着已恢复的笔记反复重试）。本地先把这行移出
    // 列表（乐观且真实：服务端已恢复），刷新失败只静默保留现状。
    if (!mountedRef.current) return;
    setNotes((prev) => prev.filter((item) => item.id !== note.id));
    try {
      await load();
    } catch {
      // 列表下次 focus / 下拉时自然重试
    }
  }, [closeMenu, load, menuNote, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      hint: { color: colors.textSecondary },
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      primary: { color: colors.primary },
    }),
    [colors],
  );

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      // 已删笔记不可打开详情（后端详情路径按 status 过滤）；点击即弹恢复菜单。
      <NoteCard note={item} onPress={setMenuNote} onMorePress={setMenuNote} />
    ),
    [],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <Text style={[s.pageTitle, d.title]}>
        {t('notes.recycleBinTitle', { defaultValue: '回收站' })}
      </Text>
      <Text style={[s.hint, d.hint]}>
        {t('notes.recycleBinHint', {
          defaultValue: '已删除的笔记可在这里恢复。',
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
        onRefresh={handleRefresh}
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
                onPress={() => void handleRefresh()}
              >
                <Text style={[s.retryText, { color: colors.white }]}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.emptyText, d.hint]}>
              {t('notes.empty.noDeleted', { defaultValue: '回收站是空的' })}
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
          onPress={() => void handleRestore()}
          accessibilityRole="button"
          accessibilityLabel={t('notes.actions.restore', {
            defaultValue: '恢复',
          })}
        >
          <Ionicons name="refresh-outline" size={20} color={colors.primary} />
          <Text style={[s.sheetLabel, d.primary]}>
            {t('notes.actions.restore', { defaultValue: '恢复' })}
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
