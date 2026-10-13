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
import { detachLocalNoteDraftsFromNote } from '@/features/notes/utils/note-editor-drafts';
import { ApiError } from '@/services/api/api-error';
import { fetchDeletedNotes, purgeNote, restoreNote } from '@/services/api/notes';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const keyExtractor = (item: NoteSummary) => item.id;

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

  // round 3 review：加载代际 —— restore 成功会推进代际，仍在飞的旧刷新
  // 响应落地时代际不匹配即丢弃，不再把刚恢复的笔记写回回收站列表。
  const loadGenerationRef = useRef(0);
  const load = useCallback(async () => {
    const generation = loadGenerationRef.current;
    const notesData = await fetchDeletedNotes();
    if (!mountedRef.current) return;
    if (generation !== loadGenerationRef.current) return;
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
  const userId = useAuthStore((state) => state.user?.id);

  // 恢复 / 立即删除请求还在路上时这行仍在列表里：不许再对它开菜单，免得对一条
  // 已经处理掉的笔记再点一次，拿到 404 与误导性的失败提示。
  const pendingIdsRef = useRef(new Set<string>());
  const openMenu = useCallback((note: NoteSummary) => {
    if (!pendingIdsRef.current.has(note.id)) setMenuNote(note);
  }, []);

  // 服务端确认这行已离开回收站：本地移除并刷新；刷新失败不再报错。
  const removeSettledNote = useCallback(
    async (noteId: string) => {
      if (!mountedRef.current) return;
      // 作废在飞的旧刷新（其响应还包含这一行）
      loadGenerationRef.current += 1;
      setNotes((prev) => prev.filter((item) => item.id !== noteId));
      try {
        await load();
      } catch {
        // 列表下次 focus / 下拉时自然重试
      }
    },
    [load],
  );

  // 立即删除不可撤销：先二次确认，确认后从列表里移除；与恢复一样，服务端成功后的
  // 刷新失败不再报错（那行已经真的删掉了）。
  const handlePurge = useCallback(() => {
    const note = menuNote;
    if (!note) return;
    closeMenu();
    Alert.alert(
      t('notes.alerts.purgeTitle', { defaultValue: '立即删除笔记？' }),
      t('notes.alerts.purgeConfirm', { defaultValue: '笔记会被永久删除，无法恢复。' }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('notes.actions.purge', { defaultValue: '立即删除' }),
          style: 'destructive',
          onPress: async () => {
            if (pendingIdsRef.current.has(note.id)) return;
            pendingIdsRef.current.add(note.id);
            try {
              try {
                await purgeNote(note.id);
              } catch (error) {
                // 404：已经被到期清理或另一台设备删掉 —— 目标状态已达成，按成功处理，
                // 否则用户会对着一条不存在的笔记反复重试。
                if (!(error instanceof ApiError && error.status === 404)) {
                  if (mountedRef.current) {
                    Alert.alert(
                      t('notes.alerts.deleteFailedTitle', { defaultValue: '删除失败' }),
                      t('common.retryLater', { defaultValue: '请稍后重试' }),
                    );
                  }
                  return;
                }
              }
              // 本地「编辑这篇笔记」的草稿改成新笔记草稿，内容保留、不再指向已删笔记。
              if (userId) {
                try {
                  detachLocalNoteDraftsFromNote(userId, note.id);
                } catch {
                  // 本地存储失败不影响删除结果；草稿保存时会按 404 提示。
                }
              }
              await removeSettledNote(note.id);
            } finally {
              pendingIdsRef.current.delete(note.id);
            }
          },
        },
      ],
    );
  }, [closeMenu, menuNote, removeSettledNote, t, userId]);

  const handleRestore = useCallback(async () => {
    const note = menuNote;
    if (!note) return;
    closeMenu();
    if (pendingIdsRef.current.has(note.id)) return;
    pendingIdsRef.current.add(note.id);
    try {
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
      await removeSettledNote(note.id);
    } finally {
      pendingIdsRef.current.delete(note.id);
    }
  }, [closeMenu, menuNote, removeSettledNote, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      hint: { color: colors.text },
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
      // 已删笔记不可打开详情（后端详情路径按 status 过滤）；点击即弹恢复菜单。
      <NoteCard note={item} onPress={openMenu} onMorePress={openMenu} />
    ),
    [openMenu],
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
          defaultValue: '已删除的笔记可在这里恢复，30 天后自动清除。',
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
          <Ionicons name="refresh-outline" size={20} color={colors.iconAccent} />
          <Text style={[s.sheetLabel, d.sheetAction]}>
            {t('notes.actions.restore', { defaultValue: '恢复' })}
          </Text>
        </Pressable>
        <Pressable
          style={s.sheetRow}
          onPress={handlePurge}
          accessibilityRole="button"
          accessibilityLabel={t('notes.actions.purge', { defaultValue: '立即删除' })}
        >
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={[s.sheetLabel, d.sheetDanger]}>
            {t('notes.actions.purge', { defaultValue: '立即删除' })}
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
