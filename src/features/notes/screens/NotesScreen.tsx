import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import {
  createNoteGroup,
  deleteNoteGroup,
  fetchNoteGroups,
  fetchNotes,
  reorderNoteGroups,
  togglePinNote,
  updateNoteGroup,
} from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type TabId = 'all' | 'ungrouped' | string;
const GROUP_ROW_HEIGHT = 64;

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [showUnlisted, setShowUnlisted] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [managerVisible, setManagerVisible] = useState(false);
  const [draftGroupName, setDraftGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragPreviewGroups, setDragPreviewGroups] = useState<NoteGroup[] | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const groupsRef = useRef<NoteGroup[]>([]);
  const dragPreviewGroupsRef = useRef<NoteGroup[] | null>(null);
  const dragMetaRef = useRef<{
    groupId: string;
    startIndex: number;
    activeIndex: number;
  } | null>(null);

  const load = useCallback(async () => {
    const [notesData, groupsData] = await Promise.all([
      fetchNotes({ status: showUnlisted ? 'UNLISTED' : 'ACTIVE' }),
      fetchNoteGroups(),
    ]);
    setNotes(notesData);
    setGroups(groupsData);
    setLoading(false);
  }, [showUnlisted]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    dragPreviewGroupsRef.current = dragPreviewGroups;
  }, [dragPreviewGroups]);

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

  const tabs = useMemo(
    () => [
      { id: 'all' as TabId, label: `全部 ${notes.length}` },
      { id: 'ungrouped' as TabId, label: `未分组 ${ungroupedCount}` },
      ...groups.map((group) => ({
        id: group.id,
        label: `${group.name} ${group.noteCount}`,
      })),
    ],
    [groups, notes.length, ungroupedCount],
  );

  const displayGroups = dragPreviewGroups ?? groups;

  const resetGroupDraft = useCallback(() => {
    setDraftGroupName('');
    setEditingGroupId(null);
    setSavingGroup(false);
  }, []);

  const closeManager = useCallback(() => {
    resetGroupDraft();
    setManagerVisible(false);
  }, [resetGroupDraft]);

  const handlePin = useCallback(async (note: NoteSummary) => {
    await togglePinNote(note.id, !note.pinned);
    setNotes((prev) =>
      prev.map((item) => (item.id === note.id ? { ...item, pinned: !item.pinned } : item)),
    );
  }, []);

  const handleSaveGroup = useCallback(async () => {
    const trimmedName = draftGroupName.trim();
    if (!trimmedName || savingGroup) return;
    setSavingGroup(true);
    try {
      if (editingGroupId) {
        const updated = await updateNoteGroup(editingGroupId, trimmedName);
        setGroups((prev) =>
          prev.map((group) => (group.id === updated.id ? updated : group)),
        );
      } else {
        const created = await createNoteGroup(trimmedName);
        setGroups((prev) => [...prev, created]);
      }
      resetGroupDraft();
    } catch {
      setSavingGroup(false);
      Alert.alert('保存失败', '分组保存失败，请稍后再试。');
    }
  }, [draftGroupName, editingGroupId, resetGroupDraft, savingGroup]);

  const handleDeleteGroup = useCallback(
    (group: NoteGroup) => {
      Alert.alert('删除分组', `删除“${group.name}”后不会删除笔记，只会移出该分组。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteNoteGroup(group.id);
              setGroups((prev) => prev.filter((item) => item.id !== group.id));
              if (activeTab === group.id) setActiveTab('all');
            } catch {
              Alert.alert('删除失败', '分组删除失败，请稍后再试。');
            }
          },
        },
      ]);
    },
    [activeTab],
  );

  const handleReorderGroups = useCallback(
    async (nextGroups: NoteGroup[]) => {
      const previousGroups = groups;
      setGroups(nextGroups);
      try {
        const orderedGroups = await reorderNoteGroups(
          nextGroups.map((group) => group.id),
        );
        setGroups(orderedGroups);
      } catch {
        setGroups(previousGroups);
        Alert.alert('排序失败', '分组顺序保存失败，请稍后再试。');
      }
    },
    [groups],
  );

  const finishDrag = useCallback(() => {
    const meta = dragMetaRef.current;
    const finalGroups = dragPreviewGroupsRef.current ?? groupsRef.current;
    const changed = finalGroups.some(
      (group, index) => group.id !== groupsRef.current[index]?.id,
    );

    dragMetaRef.current = null;
    setDraggingGroupId(null);
    setDragPreviewGroups(null);
    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: true,
      stiffness: 220,
      damping: 26,
      mass: 0.8,
    }).start(() => dragY.setValue(0));

    if (meta && changed) {
      void handleReorderGroups(finalGroups);
    }
  }, [dragY, handleReorderGroups]);

  const createDragResponder = useCallback(
    (groupId: string, startIndex: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragMetaRef.current = {
            groupId,
            startIndex,
            activeIndex: startIndex,
          };
          setDraggingGroupId(groupId);
          setDragPreviewGroups(groupsRef.current);
          dragPreviewGroupsRef.current = groupsRef.current;
          dragY.setValue(0);
        },
        onPanResponderMove: (_, gestureState) => {
          const meta = dragMetaRef.current;
          if (!meta) return;
          const source = dragPreviewGroupsRef.current ?? groupsRef.current;
          const nextIndex = Math.max(
            0,
            Math.min(
              source.length - 1,
              Math.round((meta.startIndex * GROUP_ROW_HEIGHT + gestureState.dy) / GROUP_ROW_HEIGHT),
            ),
          );

          if (nextIndex !== meta.activeIndex) {
            const nextGroups = [...source];
            const [moved] = nextGroups.splice(meta.activeIndex, 1);
            nextGroups.splice(nextIndex, 0, moved);
            meta.activeIndex = nextIndex;
            dragPreviewGroupsRef.current = nextGroups;
            setDragPreviewGroups(nextGroups);
          }

          dragY.setValue(
            gestureState.dy - (meta.activeIndex - meta.startIndex) * GROUP_ROW_HEIGHT,
          );
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
      }),
    [dragY, finishDrag],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      header: { backgroundColor: colors.background },
      headerTitle: { color: colors.text },
      unlistedBtn: {
        backgroundColor: showUnlisted ? colors.primary : colors.surface,
      },
      unlistedBtnText: {
        color: showUnlisted ? colors.white : colors.text,
      },
      tabActive: { color: colors.text },
      tabInactive: { color: colors.textSecondary },
      tabActiveLine: { backgroundColor: colors.primary },
      statsText: { color: colors.textSecondary },
      searchWrap: { backgroundColor: colors.surface },
      searchInput: { color: colors.text },
      searchPlaceholder: colors.textSecondary,
      divider: { backgroundColor: colors.surface },
      bottomBar: { backgroundColor: colors.surface },
      newBtn: { backgroundColor: colors.primary },
      newBtnText: { color: colors.white },
      otherBtnText: { color: colors.text },
      modalOverlay: { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
      modalCard: { backgroundColor: colors.surface },
      modalTitle: { color: colors.text },
      modalCopy: { color: colors.textSecondary },
      groupRow: { backgroundColor: colors.background },
      groupName: { color: colors.text },
      groupCount: { color: colors.textSecondary },
      modalInput: { color: colors.text, borderColor: colors.surface },
      modalActionText: { color: colors.textSecondary },
      saveBtn: { backgroundColor: colors.primary },
      saveBtnText: { color: colors.white },
    }),
    [colors, showUnlisted],
  );

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard
        note={item}
        onPress={() => router.push(`/(tabs)/profile/notes/${item.id}`)}
        onEditPress={() =>
          router.push(`/(tabs)/profile/notes/edit?id=${item.id}` as never)
        }
        onPinPress={() => handlePin(item)}
      />
    ),
    [handlePin, router],
  );

  const statsText = `共 ${groups.length} 个分组，合计 ${notes.length} 条笔记`;

  return (
    <View style={[s.container, d.container]}>
      <View style={[s.header, d.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[s.headerTitle, d.headerTitle]}>我的笔记</Text>
          <View style={s.headerRight}>
            <Pressable
              style={[s.unlistedBtn, d.unlistedBtn]}
              onPress={() => setShowUnlisted((value) => !value)}
            >
              <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>已下架</Text>
            </Pressable>
            <Pressable hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => router.push('/(tabs)/profile/notes/edit' as never)}
            >
              <Ionicons name="add" size={24} color={colors.text} />
            </Pressable>
          </View>
        </View>

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
          <Pressable style={s.manageTab} onPress={() => setManagerVisible(true)}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        </ScrollView>

        <Text style={[s.statsText, d.statsText]}>{statsText}</Text>

        <View style={[s.searchWrap, d.searchWrap]}>
          <Ionicons name="search-outline" size={16} color={d.searchPlaceholder} />
          <TextInput
            style={[s.searchInput, d.searchInput]}
            placeholder="输入你想搜索的内容"
            placeholderTextColor={d.searchPlaceholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <FlatList
        data={filteredNotes}
        keyExtractor={(item) => item.id}
        renderItem={renderNote}
        ItemSeparatorComponent={() => <View style={[s.divider, d.divider]} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? null : (
            <Text style={[s.emptyText, d.statsText]}>
              {search.trim() ? '没有匹配的笔记' : '暂无笔记'}
            </Text>
          )
        }
      />

      <View style={[s.bottomBar, d.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={s.bottomBtn}>
          <Ionicons name="share-outline" size={18} color={colors.text} />
          <Text style={[s.bottomBtnText, d.otherBtnText]}>分享</Text>
        </Pressable>
        <Pressable style={s.bottomBtn}>
          <Ionicons name="qr-code-outline" size={18} color={colors.text} />
          <Text style={[s.bottomBtnText, d.otherBtnText]}>二维码</Text>
        </Pressable>
        <Pressable
          style={[s.bottomBtn, s.newBtnShape, d.newBtn]}
          onPress={() => router.push('/(tabs)/profile/notes/edit' as never)}
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={[s.bottomBtnText, d.newBtnText]}>新建</Text>
        </Pressable>
      </View>

      <Modal
        visible={managerVisible}
        transparent
        animationType="fade"
        onRequestClose={closeManager}
      >
        <View style={[s.modalOverlay, d.modalOverlay]}>
          <Pressable style={s.modalBackdrop} onPress={closeManager} />
          <View style={[s.modalCard, d.modalCard]}>
            <Text style={[s.modalTitle, d.modalTitle]}>管理分组</Text>
            <Text style={[s.modalCopy, d.modalCopy]}>
              “全部”和“未分组”固定在前面，常用自定义分组可以排在前面。
            </Text>
            <ScrollView style={s.modalList} contentContainerStyle={s.modalListContent}>
              {displayGroups.map((group, index) => {
                const isDragging = draggingGroupId === group.id;
                return (
                <Animated.View
                  key={group.id}
                  style={[
                    s.groupRow,
                    d.groupRow,
                    isDragging
                      ? {
                          transform: [{ translateY: dragY }],
                          zIndex: 2,
                          opacity: 0.98,
                        }
                      : draggingGroupId
                        ? s.groupRowDimmed
                        : null,
                  ]}
                >
                  <View style={s.groupRowLeft}>
                    <View
                      {...createDragResponder(group.id, index).panHandlers}
                      style={s.dragHandleWrap}
                    >
                      <View style={s.dragHandle}>
                        <Ionicons
                          name="reorder-three-outline"
                          size={18}
                          color={colors.textSecondary}
                        />
                      </View>
                    </View>
                    <View style={s.groupRowText}>
                      <Text style={[s.groupName, d.groupName]}>{group.name}</Text>
                      <Text style={[s.groupCount, d.groupCount]}>
                        {group.noteCount} 条笔记
                      </Text>
                    </View>
                  </View>
                  <View style={s.groupRowActions}>
                    <Pressable
                      hitSlop={8}
                      onPress={() => {
                        setEditingGroupId(group.id);
                        setDraftGroupName(group.name);
                      }}
                    >
                      <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable hitSlop={8} onPress={() => handleDeleteGroup(group)}>
                      <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                </Animated.View>
              )})}
            </ScrollView>
            <View style={s.modalEditor}>
              <TextInput
                style={[s.modalInput, d.modalInput]}
                placeholder="输入分组名，如上海"
                placeholderTextColor={colors.textSecondary}
                value={draftGroupName}
                onChangeText={setDraftGroupName}
                returnKeyType="done"
                onSubmitEditing={() => void handleSaveGroup()}
              />
              <View style={s.modalButtons}>
                {editingGroupId ? (
                  <Pressable onPress={resetGroupDraft}>
                    <Text style={[s.modalActionText, d.modalActionText]}>取消编辑</Text>
                  </Pressable>
                ) : (
                  <View />
                )}
                <Pressable
                  style={[s.saveBtn, d.saveBtn]}
                  onPress={() => void handleSaveGroup()}
                  disabled={savingGroup || !draftGroupName.trim()}
                >
                  <Text style={[s.saveBtnText, d.saveBtnText]}>
                    {editingGroupId ? '保存修改' : '新增分组'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    gap: Spacing.sm,
  },
  headerTitle: { flex: 1, textAlign: 'center', ...Typography.h2 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  unlistedBtn: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  unlistedBtnText: { ...Typography.small, fontWeight: '500' },
  tabsScroll: { marginTop: Spacing.sm },
  tabsContent: { gap: Spacing.lg, paddingHorizontal: 2, alignItems: 'flex-end' },
  tab: { paddingBottom: 6, alignItems: 'center' },
  manageTab: { paddingBottom: 6, justifyContent: 'center' },
  tabText: { ...Typography.bodyRegular, fontWeight: '500' },
  tabLine: { height: 2, borderRadius: 1, width: '100%', marginTop: 4 },
  statsText: {
    ...Typography.small,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    height: 40,
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.bodyRegular },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.lg },
  emptyText: {
    textAlign: 'center',
    paddingTop: Spacing.xl,
    ...Typography.bodyRegular,
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
  newBtnShape: {},
  bottomBtnText: { ...Typography.body, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: Spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  modalTitle: { ...Typography.h3, fontWeight: '700' },
  modalCopy: { ...Typography.small },
  modalList: { maxHeight: 320 },
  modalListContent: { gap: Spacing.sm },
  groupRow: {
    height: GROUP_ROW_HEIGHT,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  groupRowDimmed: {
    opacity: 0.78,
  },
  groupRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  groupRowText: { flex: 1 },
  groupName: { ...Typography.bodyRegular, fontWeight: '600' },
  groupCount: { ...Typography.small, marginTop: 2 },
  groupRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dragHandleWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragHandle: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  modalEditor: { gap: Spacing.sm },
  modalInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.bodyRegular,
  },
  modalButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalActionText: { ...Typography.small, fontWeight: '600' },
  saveBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  saveBtnText: { ...Typography.bodyRegular, fontWeight: '600' },
});
