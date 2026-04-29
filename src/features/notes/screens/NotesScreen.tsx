import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { useNotesSettingsStore } from '@/features/notes/store/use-notes-settings-store';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import {
  createNoteGroup,
  deleteNoteGroup,
  fetchNoteDetail,
  fetchNoteGroups,
  fetchNotes,
  reorderNoteGroups,
  togglePinNote,
  updateNote,
  updateNoteGroup,
} from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type TabId = 'all' | 'ungrouped' | string;
const GROUP_ROW_HEIGHT = 64;
const MEMBERSHIP_SAVE_CONCURRENCY = 5;

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    await Promise.all(chunk.map(task));
  }
}

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const showGroups = useNotesSettingsStore((st) => st.showGroups);
  const showUngrouped = useNotesSettingsStore((st) => st.showUngrouped);
  const showSortToolbar = useNotesSettingsStore((st) => st.showSortToolbar);

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
  const [editingMembershipGroup, setEditingMembershipGroup] =
    useState<NoteGroup | null>(null);
  const [membershipNoteIds, setMembershipNoteIds] = useState<string[]>([]);
  const [membershipSearch, setMembershipSearch] = useState('');
  const [savingMemberships, setSavingMemberships] = useState(false);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragPreviewGroups, setDragPreviewGroups] = useState<NoteGroup[] | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const groupsRef = useRef<NoteGroup[]>([]);
  const dragPreviewGroupsRef = useRef<NoteGroup[] | null>(null);
  const groupNameInputRef = useRef<TextInput>(null);
  const dragRespondersRef = useRef(
    new Map<string, ReturnType<typeof PanResponder.create>>(),
  );
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

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load().catch(() => {
        setLoading(false);
      });
    }, [load]),
  );

  useEffect(() => {
    groupsRef.current = groups;
    dragRespondersRef.current.forEach((_, groupId) => {
      if (!groups.some((group) => group.id === groupId)) {
        dragRespondersRef.current.delete(groupId);
      }
    });
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

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string }[] = [
      { id: 'all', label: `全部 ${notes.length}` },
    ];
    if (showUngrouped) {
      list.push({ id: 'ungrouped', label: `未分组 ${ungroupedCount}` });
    }
    if (showGroups) {
      groups.forEach((group) => {
        list.push({ id: group.id, label: `${group.name} ${group.noteCount}` });
      });
    }
    return list;
  }, [groups, notes.length, showGroups, showUngrouped, ungroupedCount]);

  useEffect(() => {
    if (activeTab === 'ungrouped' && !showUngrouped) {
      setActiveTab('all');
      return;
    }
    if (
      !showGroups &&
      activeTab !== 'all' &&
      activeTab !== 'ungrouped' &&
      groups.some((group) => group.id === activeTab)
    ) {
      setActiveTab('all');
    }
  }, [activeTab, groups, showGroups, showUngrouped]);

  const displayGroups = dragPreviewGroups ?? groups;

  const resetGroupDraft = useCallback(() => {
    setDraftGroupName('');
    setEditingGroupId(null);
    setSavingGroup(false);
  }, []);

  const resetGroupMembershipEditor = useCallback(() => {
    setEditingMembershipGroup(null);
    setMembershipNoteIds([]);
    setMembershipSearch('');
    setSavingMemberships(false);
  }, []);

  const closeManager = useCallback(() => {
    resetGroupDraft();
    resetGroupMembershipEditor();
    setManagerVisible(false);
  }, [resetGroupDraft, resetGroupMembershipEditor]);

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

  const handleSubmitGroupPress = useCallback(() => {
    if (!draftGroupName.trim()) {
      groupNameInputRef.current?.focus();
      Alert.alert('请输入分组名', '填写分组名称后再新增分组。');
      return;
    }
    void handleSaveGroup();
  }, [draftGroupName, handleSaveGroup]);

  const openGroupMembershipEditor = useCallback(
    (group: NoteGroup) => {
      setEditingMembershipGroup(group);
      setMembershipNoteIds(
        notes
          .filter((note) => note.groups.some((item) => item.id === group.id))
          .map((note) => note.id),
      );
    },
    [notes],
  );

  const selectedMembershipNoteIds = useMemo(
    () => new Set(membershipNoteIds),
    [membershipNoteIds],
  );

  const filteredMembershipNotes = useMemo(() => {
    const query = membershipSearch.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(query) ||
        (note.contentPreview ?? '').toLowerCase().includes(query),
    );
  }, [membershipSearch, notes]);

  const toggleMembershipNote = useCallback((noteId: string) => {
    setMembershipNoteIds((prev) =>
      prev.includes(noteId)
        ? prev.filter((id) => id !== noteId)
        : [...prev, noteId],
    );
  }, []);

  const handleSaveGroupMemberships = useCallback(async () => {
    const group = editingMembershipGroup;
    if (!group || savingMemberships) return;

    setSavingMemberships(true);
    const selectedNoteIds = new Set(membershipNoteIds);
    const changedNotes = notes.filter((note) => {
      const currentlySelected = note.groups.some((item) => item.id === group.id);
      return currentlySelected !== selectedNoteIds.has(note.id);
    });

    try {
      await runWithConcurrencyLimit(
        changedNotes,
        MEMBERSHIP_SAVE_CONCURRENCY,
        async (note) => {
          const detail = await fetchNoteDetail(note.id);
          const currentGroupIds = detail.groups.map((item) => item.id);
          const nextGroupIds = selectedNoteIds.has(note.id)
            ? [...new Set([...currentGroupIds, group.id])]
            : currentGroupIds.filter((id) => id !== group.id);

          await updateNote(note.id, {
            title: detail.title,
            content: detail.content ?? undefined,
            contentJson: detail.contentJson ?? undefined,
            groupIds: nextGroupIds,
            status: detail.status === 'UNLISTED' ? 'UNLISTED' : 'ACTIVE',
            pinned: detail.pinned,
            media: detail.media.map((item) => ({
              type: item.type,
              objectKey: item.objectKey,
              url: item.url,
              mimeType: item.mimeType ?? undefined,
              size: item.size ?? undefined,
              width: item.width ?? undefined,
              height: item.height ?? undefined,
              durationMs: item.durationMs ?? undefined,
              posterUrl: item.posterUrl ?? undefined,
              sortOrder: item.sortOrder,
            })),
          });
        },
      );
      resetGroupMembershipEditor();
      await load();
    } catch {
      setSavingMemberships(false);
      Alert.alert('保存失败', '笔记分组保存失败，请稍后再试。');
    }
  }, [
    editingMembershipGroup,
    load,
    membershipNoteIds,
    notes,
    resetGroupMembershipEditor,
    savingMemberships,
  ]);

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
      const previousGroups = groupsRef.current;
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
    [],
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

  const getDragResponder = useCallback(
    (groupId: string) => {
      const cached = dragRespondersRef.current.get(groupId);
      if (cached) return cached;

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          const currentGroups = groupsRef.current;
          const startIndex = groupsRef.current.findIndex((group) => group.id === groupId);
          if (startIndex < 0) return;
          dragMetaRef.current = {
            groupId,
            startIndex,
            activeIndex: startIndex,
          };
          setDraggingGroupId(groupId);
          const nextPreviewGroups = [...currentGroups];
          setDragPreviewGroups(nextPreviewGroups);
          dragPreviewGroupsRef.current = nextPreviewGroups;
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
        onShouldBlockNativeResponder: () => true,
      });

      dragRespondersRef.current.set(groupId, responder);
      return responder;
    },
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
      membershipRowSelected: { borderColor: colors.primary },
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

  const renderMembershipNote = useCallback(
    ({ item }: { item: NoteSummary }) => {
      const selected = selectedMembershipNoteIds.has(item.id);
      return (
        <Pressable
          style={[
            s.membershipRow,
            d.groupRow,
            selected ? [s.membershipRowSelected, d.membershipRowSelected] : null,
          ]}
          onPress={() => toggleMembershipNote(item.id)}
        >
          <View style={s.membershipText}>
            <Text style={[s.groupName, d.groupName]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.contentPreview ? (
              <Text style={[s.groupCount, d.groupCount]} numberOfLines={1}>
                {item.contentPreview}
              </Text>
            ) : null}
          </View>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={selected ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      );
    },
    [
      colors.primary,
      colors.textSecondary,
      d.groupCount,
      d.groupName,
      d.groupRow,
      d.membershipRowSelected,
      selectedMembershipNoteIds,
      toggleMembershipNote,
    ],
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
              onPress={() =>
                router.push('/(tabs)/profile/notes/settings' as never)
              }
            >
              <Ionicons name="settings-outline" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>

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
          {showSortToolbar ? (
            <Pressable style={s.manageTab} onPress={() => setManagerVisible(true)}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

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
        <View style={[s.modalOverlay, d.modalOverlay]} pointerEvents="box-none">
          <Pressable style={s.modalBackdrop} onPress={closeManager} />
          <View style={[s.modalCard, d.modalCard]}>
            {editingMembershipGroup ? (
              <>
                <View style={s.membershipHeader}>
                  <Pressable onPress={resetGroupMembershipEditor} hitSlop={8}>
                    <Ionicons name="chevron-back" size={22} color={colors.text} />
                  </Pressable>
                  <Text style={[s.modalTitle, d.modalTitle]}>选择笔记</Text>
                </View>
                <Text style={[s.modalCopy, d.modalCopy]}>
                  为“{editingMembershipGroup.name}”选择要加入的笔记。
                </Text>
                <View style={[s.membershipSearchWrap, d.searchWrap]}>
                  <Ionicons name="search-outline" size={16} color={d.searchPlaceholder} />
                  <TextInput
                    style={[s.searchInput, d.searchInput]}
                    placeholder="搜索笔记"
                    placeholderTextColor={d.searchPlaceholder}
                    value={membershipSearch}
                    onChangeText={setMembershipSearch}
                  />
                </View>
                <FlatList
                  style={s.membershipList}
                  data={filteredMembershipNotes}
                  keyExtractor={(item) => item.id}
                  renderItem={renderMembershipNote}
                  ItemSeparatorComponent={() => <View style={s.membershipSeparator} />}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={
                    <Text style={[s.emptyText, d.statsText]}>
                      {notes.length === 0 ? '暂无可选择的笔记' : '没有匹配的笔记'}
                    </Text>
                  }
                />
                <View style={s.modalButtons}>
                  <Pressable onPress={resetGroupMembershipEditor}>
                    <Text style={[s.modalActionText, d.modalActionText]}>返回</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      s.saveBtn,
                      d.saveBtn,
                      savingMemberships ? s.saveBtnDisabled : null,
                    ]}
                    onPress={() => void handleSaveGroupMemberships()}
                    disabled={savingMemberships}
                  >
                    <Text style={[s.saveBtnText, d.saveBtnText]}>
                      {savingMemberships ? '保存中...' : '保存选择'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={[s.modalTitle, d.modalTitle]}>管理分组</Text>
                <Text style={[s.modalCopy, d.modalCopy]}>
                  “全部”和“未分组”固定在前面，常用自定义分组可以排在前面。
                </Text>
                <ScrollView
                  style={s.modalList}
                  contentContainerStyle={s.modalListContent}
                  scrollEnabled={!draggingGroupId}
                >
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
                          {...getDragResponder(group.id).panHandlers}
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
                        <Pressable hitSlop={8} onPress={() => openGroupMembershipEditor(group)}>
                          <Ionicons name="list-outline" size={18} color={colors.textSecondary} />
                        </Pressable>
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
                    ref={groupNameInputRef}
                    style={[s.modalInput, d.modalInput]}
                    placeholder="输入分组名，如上海"
                    placeholderTextColor={colors.textSecondary}
                    value={draftGroupName}
                    onChangeText={setDraftGroupName}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmitGroupPress}
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
                      style={[s.saveBtn, d.saveBtn, savingGroup ? s.saveBtnDisabled : null]}
                      onPress={handleSubmitGroupPress}
                      disabled={savingGroup}
                    >
                      <Text style={[s.saveBtnText, d.saveBtnText]}>
                        {savingGroup ? '保存中...' : editingGroupId ? '保存修改' : '新增分组'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </>
            )}
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
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: Spacing.sm,
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
    zIndex: 0,
  },
  modalCard: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    zIndex: 1,
    elevation: 1,
  },
  modalTitle: { ...Typography.h3, fontWeight: '700' },
  modalCopy: { ...Typography.small },
  modalList: { maxHeight: 320 },
  modalListContent: { gap: Spacing.sm },
  membershipList: { maxHeight: 320 },
  membershipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  membershipSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    height: 40,
    gap: Spacing.xs,
  },
  membershipRow: {
    minHeight: 56,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  membershipRowSelected: {
    borderWidth: 1,
  },
  membershipSeparator: { height: Spacing.sm },
  membershipText: { flex: 1 },
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
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: { ...Typography.bodyRegular, fontWeight: '600' },
});
