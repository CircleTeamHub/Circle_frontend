import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  NoteCard,
  type NoteSourceTarget,
} from '@/features/notes/components/NoteCard';
import { NoteActionsSheet } from '@/features/notes/components/NoteActionsSheet';
import { NoteRemarkSheet } from '@/features/notes/components/NoteRemarkSheet';
import { NoteGroupPickerSheet } from '@/features/notes/components/NoteGroupPickerSheet';
import { ShareNoteSheet } from '@/features/notes/components/ShareNoteSheet';
import { GroupManagerSheet } from '@/features/notes/components/GroupManagerSheet';
import { buildNoteCardPayloadFromSummary } from '@/features/chat/utils/note-card-payload';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import { runNoteBatch } from '@/features/notes/utils/batch-run';
import {
  pruneSelection,
  toggleId,
  toggleSelectAll,
} from '@/features/notes/utils/note-selection';
import {
  NOTES_TAB_ALL,
  NOTES_TAB_UNGROUPED,
  mergeTabOrder,
} from '@/features/notes/utils/tab-order';
import { useNotesTabOrderStore } from '@/features/notes/store/use-notes-tab-order-store';
import {
  getChatDetailHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import {
  deleteNote,
  fetchNoteGroups,
  fetchNotes,
  togglePinNote,
  unlistNote,
} from '@/services/api/notes';
import { useAuthStore } from '@/stores/authStore';
import type { NoteCardData } from '@/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

type TabId = 'all' | 'ungrouped' | string;

const keyExtractor = (item: NoteSummary) => item.id;

// 提到组件外并 memo：内联箭头组件每次渲染都是新类型，FlatList 无法复用分隔线。
const ItemSeparator = memo(function ItemSeparator() {
  const { colors } = useTheme();
  return <View style={[s.divider, { backgroundColor: colors.divider }]} />;
});

export default function NotesScreen() {
  const router = useRouter();
  // 笔记页在哪个 tab 栈打开（profile/messages/...），决定子页面往哪个栈推。
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // 「⋯」动作菜单针对的笔记（null = 关闭）
  const [menuNote, setMenuNote] = useState<NoteSummary | null>(null);
  // 多选「下一步」打开的批量动作菜单（与 ⋯ 菜单同一个 sheet 组件的批量态）
  const [batchSheetNotes, setBatchSheetNotes] = useState<NoteSummary[] | null>(
    null,
  );
  // 分享会话选择器：非空即打开，携带要发送的笔记卡片（单条=[payload]，批量=全部）
  const [shareNotePayloads, setShareNotePayloads] = useState<
    NoteCardData[] | null
  >(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const [managerVisible, setManagerVisible] = useState(false);
  const tabOrderIds = useNotesTabOrderStore((state) => state.orderIds);
  // 从别处「查看」跳进来时要定位的笔记：滚到它并短暂高亮。
  const { highlightNoteId } = useLocalSearchParams<{ highlightNoteId?: string }>();
  const listRef = useRef<FlatList<NoteSummary>>(null);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);
  const handledHighlightRef = useRef<string | null>(null);
  // 多选模式：selectedIds 为唯一事实，Set 只做派生查询
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 备注弹层的目标（单条=[note]，批量=选中集；null = 关闭）
  const [remarkNotes, setRemarkNotes] = useState<NoteSummary[] | null>(null);
  // 分组勾选弹层的目标（单条=[note]，批量=选中集；null = 关闭）
  const [groupPickerNotes, setGroupPickerNotes] = useState<
    NoteSummary[] | null
  >(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    const [notesData, groupsData] = await Promise.all([
      fetchNotes({ status: 'ACTIVE' }),
      fetchNoteGroups(),
    ]);
    if (!mountedRef.current) return;
    setNotes(notesData);
    setGroups(groupsData);
    // 刷新后清掉已不在列表里的选中项 —— 被删/下架的笔记退出批量目标
    setSelectedIds((prev) =>
      pruneSelection(
        prev,
        notesData.map((note) => note.id),
      ),
    );
    setLoadError(false);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load().catch(() => {
        // 加载失败不能静默吞掉 —— 空列表和网络错误要区分开，给用户重试入口。
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

  const filteredNotes = useMemo(() => {
    let result = notes;
    if (activeTab === 'ungrouped') {
      result = result.filter((note) => note.groups.length === 0);
    } else if (activeTab !== 'all') {
      result = result.filter((note) =>
        note.groups.some((group) => group.id === activeTab),
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (note) =>
          note.title.toLowerCase().includes(q) ||
          (note.contentPreview ?? '').toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [notes, activeTab, search]);

  const ungroupedCount = useMemo(
    () => notes.filter((note) => note.groups.length === 0).length,
    [notes],
  );

  /**
   * 「查看」跳进来的定位：滚到那条笔记并短暂高亮。
   *
   * 目标笔记可能不在当前 tab / 被搜索词滤掉（比如刚从聊天添加进来的那条），
   * 先把视图复位到「全部」且清空搜索，再等这一帧的 filteredNotes 重算出来
   * 才拿得到正确下标。handledHighlightRef 保证同一个 id 只定位一次 ——
   * 否则每次 focus 回来都会重播一遍滚动。
   */
  useEffect(() => {
    if (!highlightNoteId) return;
    if (handledHighlightRef.current === highlightNoteId) return;
    if (!notes.some((note) => note.id === highlightNoteId)) return;

    handledHighlightRef.current = highlightNoteId;
    setActiveTab('all');
    setSearch('');
    setHighlightedNoteId(highlightNoteId);
    // 消费完就把参数从路由上摘掉：留着的话，从详情页返回本列表时这个
    // effect 会拿着旧 id 再跑一次（handledHighlightRef 只挡得住同一个 id，
    // 挡不住「跳过 A 之后再跳 B、返回时又被 A 拽回去」）。
    router.setParams({ highlightNoteId: undefined });
  }, [highlightNoteId, notes, router]);

  useEffect(() => {
    if (!highlightedNoteId) return;
    const index = filteredNotes.findIndex(
      (note) => note.id === highlightedNoteId,
    );
    if (index < 0) return;
    // 等列表把新数据渲染上去再滚，否则 scrollToIndex 拿到的是旧行数。
    const scrollTimer = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.3,
      });
    }, 120);
    const clearTimer = setTimeout(() => setHighlightedNoteId(null), 2400);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [filteredNotes, highlightedNoteId]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // 目标行还没测量到：先按估算高度滚过去，下一帧再精确对齐。
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: info.index,
          animated: true,
          viewPosition: 0.3,
        });
      }, 80);
    },
    [],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedNotes = useMemo(
    () => notes.filter((note) => selectedSet.has(note.id)),
    [notes, selectedSet],
  );
  const visibleIds = useMemo(
    () => filteredNotes.map((note) => note.id),
    [filteredNotes],
  );
  const allVisibleSelected = useMemo(
    () => visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id)),
    [selectedSet, visibleIds],
  );

  const enterSelection = useCallback((note?: NoteSummary) => {
    setSelectionMode(true);
    setSelectedIds(note ? [note.id] : []);
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const toggleNoteSelection = useCallback((note: NoteSummary) => {
    setSelectedIds((prev) => toggleId(prev, note.id));
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => toggleSelectAll(prev, visibleIds));
  }, [visibleIds]);

  // tab 顺序（含「全部/未分组」的位置）由管理分组页拖动决定，本地持久化。
  const tabs = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    return mergeTabOrder(
      tabOrderIds,
      groups.map((group) => group.id),
    ).flatMap<{ id: TabId; label: string }>((id) => {
      if (id === NOTES_TAB_ALL) {
        return [
          {
            id: 'all',
            label: t('notes.tabs.all', {
              count: notes.length,
              defaultValue: `全部 ${notes.length}`,
            }),
          },
        ];
      }
      if (id === NOTES_TAB_UNGROUPED) {
        return [
          {
            id: 'ungrouped',
            label: t('notes.tabs.ungrouped', {
              count: ungroupedCount,
              defaultValue: `未分组 ${ungroupedCount}`,
            }),
          },
        ];
      }
      const group = byId.get(id);
      return group
        ? [{ id: group.id, label: `${group.name} ${group.noteCount}` }]
        : [];
    });
  }, [groups, notes.length, t, tabOrderIds, ungroupedCount]);

  const closeManager = useCallback(() => setManagerVisible(false), []);

  const handleActiveGroupDeleted = useCallback(
    (groupId: string) => {
      if (activeTab === groupId) setActiveTab('all');
    },
    [activeTab],
  );

  const handlePin = useCallback(
    async (note: NoteSummary) => {
      try {
        await togglePinNote(note.id, !note.pinned);
      } catch {
        if (mountedRef.current) {
          Alert.alert(
            t('notes.alerts.pinFailedTitle', { defaultValue: '操作失败' }),
            t('common.retryLater', { defaultValue: '请稍后重试' }),
          );
        }
        return;
      }
      if (!mountedRef.current) return;
      setNotes((prev) =>
        prev.map((item) => (item.id === note.id ? { ...item, pinned: !item.pinned } : item)),
      );
    },
    [t],
  );

  // NoteCard 已 memo：回调保持稳定引用，搜索输入等高频重渲时卡片不再全量重绘。
  const openNote = useCallback(
    (note: NoteSummary) =>
      router.push({
        pathname: '/(tabs)/profile/notes/[id]',
        params: { id: note.id, ownerId: currentUserId ?? '' },
      } as never),
    [currentUserId, router],
  );

  const openNoteEditor = useCallback(
    (note: NoteSummary) =>
      router.push(`/(tabs)/profile/notes/edit?id=${note.id}` as never),
    [router],
  );

  const openMenu = useCallback((note: NoteSummary) => setMenuNote(note), []);
  // 单选 ⋯ 菜单与批量「下一步」共用同一个 sheet：关闭时两种目标一起清。
  const closeMenu = useCallback(() => {
    setMenuNote(null);
    setBatchSheetNotes(null);
  }, []);

  // 多选模式下点卡片 = 勾选/取消勾选；正常模式进详情。
  const handleCardPress = useCallback(
    (note: NoteSummary) => {
      if (selectionMode) {
        toggleNoteSelection(note);
        return;
      }
      openNote(note);
    },
    [openNote, selectionMode, toggleNoteSelection],
  );

  const handleCardLongPress = useCallback(
    (note: NoteSummary) => {
      if (!selectionMode) enterSelection(note);
    },
    [enterSelection, selectionMode],
  );

  // 来源 chip：发送者 → 私聊（不带会话 id 也能按 sourceID 打开），群 → 群聊。
  // 与详情页跳回来源一致，固定挂 messages 栈。
  const handleSourcePress = useCallback(
    (note: NoteSummary, target: NoteSourceTarget) => {
      const from = note.collectedFrom;
      if (!from) return;
      // 聊天页入**当前所在** tab 栈（笔记多挂在 profile 下），不写死 messages ——
      // 写死会把聊天页推进消息栈，返回时落到 IM 首页而不是来时的笔记页。
      if (target === 'group') {
        const group = from.group;
        if (!group?.id || !group.name) return;
        router.push(
          getChatDetailHref(
            scope,
            group.id,
            group.name,
            group.faceURL ?? undefined,
            from.conversationID,
            // 带上收藏时的消息 id：进群直接定位到这条笔记的原消息。
            from.clientMsgID,
            'group',
          ),
        );
        return;
      }
      const sender = from.sender;
      if (!sender?.id || !sender.name) return;
      router.push(
        getChatDetailHref(
          scope,
          sender.id,
          sender.name,
          sender.faceURL ?? undefined,
          from.conversationType === 'private' ? from.conversationID : undefined,
          undefined,
          'private',
        ),
      );
    },
    [router, scope],
  );

  const handleMultiSelectFromMenu = useCallback(
    (note: NoteSummary) => enterSelection(note),
    [enterSelection],
  );

  const handleRemark = useCallback(
    (note: NoteSummary) => setRemarkNotes([note]),
    [],
  );
  const handleBatchRemark = useCallback(
    (notes: NoteSummary[]) => setRemarkNotes(notes),
    [],
  );
  const closeRemark = useCallback(() => setRemarkNotes(null), []);

  const handleRemarkSaved = useCallback(
    (noteIds: string[], remark: string | null) => {
      const savedSet = new Set(noteIds);
      setNotes((prev) =>
        prev.map((item) =>
          savedSet.has(item.id) ? { ...item, remark } : item,
        ),
      );
      // 批量备注保存后退出多选（部分失败已由弹层提示过）；单条场景本就不在多选态。
      exitSelection();
    },
    [exitSelection],
  );

  const handleEditGroups = useCallback(
    (note: NoteSummary) => setGroupPickerNotes([note]),
    [],
  );
  const handleBatchEditGroups = useCallback((notes: NoteSummary[]) => {
    if (notes.length === 0) return;
    setGroupPickerNotes(notes);
  }, []);
  const closeGroupPicker = useCallback(() => setGroupPickerNotes(null), []);

  const handleGroupPickerSaved = useCallback(() => {
    // 不论全成还是部分失败都重拉真状态；批量场景顺手退出多选。
    void load().catch(() => {});
    exitSelection();
  }, [exitSelection, load]);

  // 分组弹层里就地新建的分组：并进列表，tab 栏与管理页立即可见。
  const handleGroupCreatedInPicker = useCallback(
    (group: NoteGroup) => setGroups((prev) => [...prev, group]),
    [],
  );

  // 分享：打开会话选择器，把笔记以卡片消息发给好友/群聊（批量=逐条发卡）。
  const handleShareNote = useCallback(
    (note: NoteSummary) => {
      setShareNotePayloads([
        buildNoteCardPayloadFromSummary(note, note.ownerId ?? currentUserId),
      ]);
    },
    [currentUserId],
  );
  const handleBatchShare = useCallback(
    (notes: NoteSummary[]) => {
      setShareNotePayloads(
        notes.map((note) =>
          buildNoteCardPayloadFromSummary(note, note.ownerId ?? currentUserId),
        ),
      );
    },
    [currentUserId],
  );
  const closeShareNote = useCallback(() => setShareNotePayloads(null), []);

  const handleUnlistNote = useCallback(
    (note: NoteSummary) => {
      Alert.alert(
        t('notes.alerts.unlistTitle', { defaultValue: '下架笔记' }),
        t('notes.alerts.unlistConfirm', {
          defaultValue: '下架后可在已下架列表查看，并可随时重新上架。',
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('notes.actions.unlist', { defaultValue: '下架' }),
            style: 'destructive',
            onPress: async () => {
              try {
                await unlistNote(note.id);
                if (mountedRef.current) await load();
              } catch {
                if (mountedRef.current) {
                  Alert.alert(
                    t('notes.alerts.unlistFailedTitle', { defaultValue: '下架失败' }),
                    t('common.retryLater', { defaultValue: '请稍后重试' }),
                  );
                }
              }
            },
          },
        ],
      );
    },
    [load, t],
  );

  const handleDeleteNote = useCallback(
    (note: NoteSummary) => {
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
                if (mountedRef.current) await load();
              } catch {
                if (mountedRef.current) {
                  Alert.alert(
                    t('notes.alerts.deleteFailedTitle', {
                      defaultValue: '删除失败',
                    }),
                    t('common.retryLater', { defaultValue: '请稍后重试' }),
                  );
                }
              }
            },
          },
        ],
      );
    },
    [load, t],
  );

  // 批量删除/下架共用：settle 后重拉列表；失败的留在选中集里方便直接重试。
  const runBatchAction = useCallback(
    async (ids: string[], task: (id: string) => Promise<void>) => {
      const { failed } = await runNoteBatch(ids, task);
      if (!mountedRef.current) return;
      await load().catch(() => {});
      if (!mountedRef.current) return;
      if (failed.length > 0) {
        setSelectedIds(failed);
        Alert.alert(
          t('notes.alerts.batchFailedTitle', { defaultValue: '部分操作失败' }),
          t('notes.alerts.batchPartialFailed', {
            count: failed.length,
            defaultValue: `有 ${failed.length} 条笔记操作失败，已保留选中，请重试。`,
          }),
        );
      } else {
        exitSelection();
      }
    },
    [exitSelection, load, t],
  );

  const handleBatchUnlist = useCallback(
    (notes: NoteSummary[]) => {
      if (notes.length === 0) return;
      const ids = notes.map((item) => item.id);
      Alert.alert(
        t('notes.alerts.batchUnlistTitle', { defaultValue: '批量下架' }),
        t('notes.alerts.batchUnlistConfirm', {
          count: ids.length,
          defaultValue: `确定下架所选 ${ids.length} 条笔记吗？下架后可随时重新上架。`,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('notes.actions.unlist', { defaultValue: '下架' }),
            style: 'destructive',
            onPress: () => void runBatchAction(ids, (id) => unlistNote(id)),
          },
        ],
      );
    },
    [runBatchAction, t],
  );

  const handleBatchDelete = useCallback(
    (notes: NoteSummary[]) => {
      if (notes.length === 0) return;
      const ids = notes.map((item) => item.id);
      Alert.alert(
        t('notes.alerts.batchDeleteTitle', { defaultValue: '批量删除' }),
        t('notes.alerts.batchDeleteConfirm', {
          count: ids.length,
          defaultValue: `确定删除所选 ${ids.length} 条笔记吗？删除后可在回收站找回。`,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('notes.actions.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: () => void runBatchAction(ids, (id) => deleteNote(id)),
          },
        ],
      );
    },
    [runBatchAction, t],
  );

  // 批量置顶/取消置顶：目标状态由「是否全部已置顶」推导，可逆操作不弹确认。
  const handleBatchPin = useCallback(
    (notes: NoteSummary[], pinned: boolean) => {
      if (notes.length === 0) return;
      void runBatchAction(
        notes.map((item) => item.id),
        (id) => togglePinNote(id, pinned),
      );
    },
    [runBatchAction],
  );

  // 多选「下一步」：把当前选中集交给与 ⋯ 菜单同款的动作 sheet（批量态）。
  const openBatchSheet = useCallback(() => {
    if (selectedNotes.length === 0) return;
    setBatchSheetNotes(selectedNotes);
  }, [selectedNotes]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      header: { backgroundColor: colors.background },
      headerTitle: { color: colors.text },
      unlistedBtn: {
        backgroundColor: colors.surface,
      },
      unlistedBtnText: {
        color: colors.text,
      },
      tabActive: { color: colors.text },
      tabInactive: { color: colors.textSecondary },
      tabActiveLine: { backgroundColor: colors.primary },
      statsText: { color: colors.textSecondary },
      searchWrap: { backgroundColor: colors.surface },
      searchInput: { color: colors.text },
      searchPlaceholder: colors.textSecondary,
      divider: { backgroundColor: colors.divider },
      bottomBar: {
        backgroundColor: colors.background,
        borderTopColor: colors.surfaceBorder,
      },
      newBtn: { backgroundColor: colors.primary },
      newBtnText: { color: colors.white },
    }),
    [colors],
  );

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard
        note={item}
        onPress={handleCardPress}
        onMorePress={openMenu}
        onLongPress={handleCardLongPress}
        onSourcePress={handleSourcePress}
        selectionMode={selectionMode}
        selected={selectedSet.has(item.id)}
        highlighted={highlightedNoteId === item.id}
      />
    ),
    [
      handleCardLongPress,
      handleCardPress,
      handleSourcePress,
      highlightedNoteId,
      openMenu,
      selectedSet,
      selectionMode,
    ],
  );

  const statsText = t('notes.stats', {
    groupCount: groups.length,
    noteCount: notes.length,
    defaultValue: `共 ${groups.length} 个分组，合计 ${notes.length} 条笔记`,
  });

  return (
    <View style={[s.container, d.container]}>
      <View style={[s.header, d.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={s.headerRight}>
            {selectionMode ? (
              <>
                <Pressable
                  style={[s.unlistedBtn, d.unlistedBtn]}
                  onPress={handleToggleSelectAll}
                >
                  <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>
                    {allVisibleSelected
                      ? t('notes.selection.clearAll', {
                          defaultValue: '取消全选',
                        })
                      : t('notes.selection.selectAll', { defaultValue: '全选' })}
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.unlistedBtn, d.unlistedBtn]}
                  onPress={exitSelection}
                >
                  <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>
                    {t('common.cancel', { defaultValue: '取消' })}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={[s.unlistedBtn, d.unlistedBtn]}
                  onPress={() =>
                    router.push('/(tabs)/profile/notes/recycle-bin' as never)
                  }
                >
                  <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>
                    {t('notes.recycleBin', { defaultValue: '回收站' })}
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.unlistedBtn, d.unlistedBtn]}
                  onPress={() =>
                    router.push('/(tabs)/profile/notes/unlisted' as never)
                  }
                >
                  <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>
                    {t('notes.unlisted', { defaultValue: '已下架' })}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* 大标题 + 统计副标题：列表页的"刊头"，其余元素都退到次级 */}
        <Text style={[s.pageTitle, d.headerTitle]}>
          {t('notes.title', { defaultValue: '我的笔记' })}
        </Text>
        <Text style={[s.statsText, d.statsText]}>
          {selectionMode
            ? t('notes.selection.selectedCount', {
                count: selectedIds.length,
                defaultValue: `已选 ${selectedIds.length} 项`,
              })
            : statsText}
        </Text>

        <View style={s.tabsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.tabsScroll}
            contentContainerStyle={s.tabsContent}
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <Pressable key={tab.id} style={s.tab} onPress={() => setActiveTab(tab.id)}>
                  <Text style={[s.tabText, isActive ? d.tabActive : d.tabInactive]}>
                    {tab.label}
                  </Text>
                  {isActive ? <View style={[s.tabLine, d.tabActiveLine]} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={s.manageTab} onPress={() => setManagerVisible(true)}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={[s.searchWrap, d.searchWrap]}>
          <Ionicons name="search-outline" size={16} color={d.searchPlaceholder} />
          <TextInput
            style={[s.searchInput, d.searchInput]}
            placeholder={t('notes.searchPlaceholder', {
              defaultValue: '输入你想搜索的内容',
            })}
            placeholderTextColor={d.searchPlaceholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={filteredNotes}
        keyExtractor={keyExtractor}
        renderItem={renderNote}
        ItemSeparatorComponent={ItemSeparator}
        // 卡片高度不定（有无封面/备注/来源按钮），定位滚动用 onScrollToIndexFailed
        // 兜底重试，而不是硬算 getItemLayout。
        onScrollToIndexFailed={handleScrollToIndexFailed}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        {...keyboardDismissOnDragProps}
        refreshing={refreshing}
        onRefresh={handleRefreshNotes}
        ListEmptyComponent={
          loading ? null : loadError ? (
            <View style={s.emptyWrap}>
              <Text style={[s.emptyText, d.statsText]}>
                {t('notes.loadFailed', {
                  defaultValue: '笔记加载失败，请检查网络后重试',
                })}
              </Text>
              <Pressable
                style={[s.retryBtn, d.newBtn]}
                onPress={() => void handleRefreshNotes()}
              >
                <Text style={[s.bottomBtnText, d.newBtnText]}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.emptyText, d.statsText]}>
              {search.trim()
                ? t('notes.empty.noMatch', { defaultValue: '没有匹配的笔记' })
                : t('notes.empty.noNotes', { defaultValue: '暂无笔记' })}
            </Text>
          )
        }
      />

      <View style={[s.bottomBar, d.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        {selectionMode ? (
          <Pressable
            style={[
              s.bottomBtn,
              d.newBtn,
              selectedIds.length === 0 ? s.btnDisabled : null,
            ]}
            onPress={openBatchSheet}
            disabled={selectedIds.length === 0}
            accessibilityRole="button"
          >
            <Text style={[s.bottomBtnText, d.newBtnText]}>
              {t('notes.selection.next', { defaultValue: '下一步' })}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[s.bottomBtn, d.newBtn]}
            onPress={() => router.push('/(tabs)/profile/notes/edit' as never)}
          >
            <Ionicons name="add" size={18} color={colors.white} />
            <Text style={[s.bottomBtnText, d.newBtnText]}>
              {t('notes.actions.new', { defaultValue: '新建' })}
            </Text>
          </Pressable>
        )}
      </View>

      <GroupManagerSheet
        visible={managerVisible}
        onClose={closeManager}
        groups={groups}
        setGroups={setGroups}
        notes={notes}
        onMembershipsChanged={load}
        onActiveGroupDeleted={handleActiveGroupDeleted}
      />
      <NoteActionsSheet
        note={menuNote}
        batchNotes={batchSheetNotes}
        onClose={closeMenu}
        onPin={handlePin}
        onMultiSelect={handleMultiSelectFromMenu}
        onRemark={handleRemark}
        onEdit={openNoteEditor}
        onEditGroups={handleEditGroups}
        onShare={handleShareNote}
        onDelete={handleDeleteNote}
        onUnlist={handleUnlistNote}
        onBatchPin={handleBatchPin}
        onBatchRemark={handleBatchRemark}
        onBatchEditGroups={handleBatchEditGroups}
        onBatchShare={handleBatchShare}
        onBatchUnlist={handleBatchUnlist}
        onBatchDelete={handleBatchDelete}
      />
      <NoteRemarkSheet
        notes={remarkNotes}
        onClose={closeRemark}
        onSaved={handleRemarkSaved}
      />
      <NoteGroupPickerSheet
        notes={groupPickerNotes}
        groups={groups}
        onClose={closeGroupPicker}
        onSaved={handleGroupPickerSaved}
        onGroupCreated={handleGroupCreatedInPicker}
      />
      <ShareNoteSheet payloads={shareNotePayloads} onClose={closeShareNote} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pageTitle: { ...Typography.h1, marginTop: Spacing.xs },
  unlistedBtn: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  unlistedBtnText: { ...Typography.small, fontWeight: '500' },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: Spacing.md,
  },
  tabsScroll: { flex: 1 },
  tabsContent: { gap: Spacing.lg, paddingHorizontal: 2, alignItems: 'flex-end' },
  tab: { paddingBottom: 6, alignItems: 'center' },
  manageTab: {
    width: 40,
    paddingBottom: 6,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tabText: { ...Typography.bodyRegular, fontWeight: '500' },
  tabLine: { height: 2, borderRadius: 1, width: '100%', marginTop: 4 },
  statsText: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  searchInput: { flex: 1, ...Typography.bodyRegular },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.lg },
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
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm + 4,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: Radius.pill,
    gap: Spacing.xs,
  },
  bottomBtnText: { ...Typography.body, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
});
