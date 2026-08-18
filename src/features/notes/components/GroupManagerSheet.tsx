import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createNoteGroup,
  deleteNoteGroup,
  reorderNoteGroups,
  updateNoteGroup,
  updateNoteGroupIds,
} from '@/services/api/notes';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import { useNotesTabOrderStore } from '@/features/notes/store/use-notes-tab-order-store';
import { NOTES_TAB_ALL, mergeTabOrder } from '@/features/notes/utils/tab-order';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

// 抽自 NotesScreen 的"管理分组"Modal —— 把 group CRUD、拖拽排序、成员选择器一并搬过来。
// state 全部内聚到这个组件，父组件只关心：何时显示、关掉时回调、需要刷新外层 notes 时回调。
interface Props {
  visible: boolean;
  onClose: () => void;
  groups: NoteGroup[];
  setGroups: React.Dispatch<React.SetStateAction<NoteGroup[]>>;
  notes: NoteSummary[];
  /** 当成员关系修改保存成功后，由父组件触发一次 fetchNotes() 刷新 */
  onMembershipsChanged: () => Promise<void>;
  /** 当用户删除当前激活的 tab 对应的 group 时，由父组件把 activeTab 重置回 'all' */
  onActiveGroupDeleted: (groupId: string) => void;
}

const GROUP_ROW_HEIGHT = 64;
export const MAX_NOTE_GROUPS = 10;
/** 与后端 CreateNoteGroupDto 的 @MaxLength(30) 对齐 */
export const GROUP_NAME_MAX_LENGTH = 30;
const MEMBERSHIP_SAVE_CONCURRENCY = 5;

/** 排序列表里的一行：固定 tab（全部/未分组，group=null）或用户分组。 */
interface ManagerRow {
  id: string;
  group: NoteGroup | null;
}

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

export function GroupManagerSheet({
  visible,
  onClose,
  groups,
  setGroups,
  notes,
  onMembershipsChanged,
  onActiveGroupDeleted,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tabOrderIds = useNotesTabOrderStore((state) => state.orderIds);
  const setTabOrderIds = useNotesTabOrderStore((state) => state.setOrderIds);

  const [draftGroupName, setDraftGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  // 新增/改名共用的弹出编辑 sheet（常驻输入框已移除）。
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [editingMembershipGroup, setEditingMembershipGroup] =
    useState<NoteGroup | null>(null);
  const [membershipNoteIds, setMembershipNoteIds] = useState<string[]>([]);
  const [membershipSearch, setMembershipSearch] = useState('');
  const [savingMemberships, setSavingMemberships] = useState(false);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragPreviewRows, setDragPreviewRows] = useState<ManagerRow[] | null>(
    null,
  );
  const dragY = useRef(new Animated.Value(0)).current;
  const rowsRef = useRef<ManagerRow[]>([]);
  const dragPreviewRowsRef = useRef<ManagerRow[] | null>(null);
  const groupNameInputRef = useRef<TextInput>(null);
  const dragRespondersRef = useRef(
    new Map<string, ReturnType<typeof PanResponder.create>>(),
  );
  const dragMetaRef = useRef<{
    rowId: string;
    startIndex: number;
    activeIndex: number;
  } | null>(null);

  // 固定 tab（全部/未分组）与用户分组同列表排序：整条顺序走本地持久化，
  // 分组之间的相对顺序仍写回服务端 sortOrder。
  const rows = useMemo<ManagerRow[]>(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    return mergeTabOrder(
      tabOrderIds,
      groups.map((group) => group.id),
    ).map((id) => ({ id, group: byId.get(id) ?? null }));
  }, [groups, tabOrderIds]);

  const ungroupedCount = useMemo(
    () => notes.filter((note) => note.groups.length === 0).length,
    [notes],
  );

  useEffect(() => {
    rowsRef.current = rows;
    dragRespondersRef.current.forEach((_, rowId) => {
      if (!rows.some((row) => row.id === rowId)) {
        dragRespondersRef.current.delete(rowId);
      }
    });
  }, [rows]);

  useEffect(() => {
    dragPreviewRowsRef.current = dragPreviewRows;
  }, [dragPreviewRows]);


  const displayRows = dragPreviewRows ?? rows;
  const isCreatingGroupAtLimit =
    !editingGroupId && groups.length >= MAX_NOTE_GROUPS;

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

  const resetDragState = useCallback(() => {
    dragMetaRef.current = null;
    dragPreviewRowsRef.current = null;
    dragY.stopAnimation();
    dragY.setValue(0);
    setDraggingRowId(null);
    setDragPreviewRows(null);
  }, [dragY]);

  const handleClose = useCallback(() => {
    resetDragState();
    resetGroupDraft();
    setGroupEditorOpen(false);
    resetGroupMembershipEditor();
    onClose();
  }, [onClose, resetDragState, resetGroupDraft, resetGroupMembershipEditor]);

  const handleSaveGroup = useCallback(async () => {
    const trimmedName = draftGroupName.trim();
    if (!trimmedName || savingGroup || isCreatingGroupAtLimit) return;
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
      setGroupEditorOpen(false);
    } catch (error) {
      setSavingGroup(false);
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        getApiErrorMessage(
          error,
          t('notes.alerts.saveGroupFailed', {
            defaultValue: '分组保存失败，请稍后再试。',
          }),
        ),
      );
      if (__DEV__) {
        console.warn('[GroupManagerSheet] saveGroup failed', error);
      }
    }
  }, [
    draftGroupName,
    editingGroupId,
    isCreatingGroupAtLimit,
    resetGroupDraft,
    savingGroup,
    setGroups,
    t,
  ]);

  // 「+ 新增分组」：达到上限直接拦，否则清草稿弹出编辑 sheet。
  const openCreateGroupEditor = useCallback(() => {
    if (isCreatingGroupAtLimit) {
      Alert.alert(
        t('notes.alerts.groupLimitTitle', { defaultValue: '分组已达上限' }),
        t('notes.alerts.groupLimitMessage', {
          max: MAX_NOTE_GROUPS,
          defaultValue: `最多只能创建 ${MAX_NOTE_GROUPS} 个分组。`,
        }),
      );
      return;
    }
    resetGroupDraft();
    setGroupEditorOpen(true);
  }, [isCreatingGroupAtLimit, resetGroupDraft, t]);

  const openRenameGroupEditor = useCallback((group: NoteGroup) => {
    setEditingGroupId(group.id);
    setDraftGroupName(group.name);
    setGroupEditorOpen(true);
  }, []);

  const closeGroupEditor = useCallback(() => {
    setGroupEditorOpen(false);
    resetGroupDraft();
  }, [resetGroupDraft]);

  const editingGroupName = editingGroupId
    ? (groups.find((group) => group.id === editingGroupId)?.name ?? '')
    : '';

  const handleSubmitGroupPress = useCallback(() => {
    if (!draftGroupName.trim()) {
      groupNameInputRef.current?.focus();
      Alert.alert(
        t('notes.alerts.groupNameRequiredTitle', {
          defaultValue: '请输入分组名',
        }),
        t('notes.alerts.groupNameRequiredMessage', {
          defaultValue: '填写分组名称后再新增分组。',
        }),
      );
      return;
    }
    if (isCreatingGroupAtLimit) {
      Alert.alert(
        t('notes.alerts.groupLimitTitle', {
          defaultValue: '分组已达上限',
        }),
        t('notes.alerts.groupLimitMessage', {
          max: MAX_NOTE_GROUPS,
          defaultValue: `最多只能创建 ${MAX_NOTE_GROUPS} 个分组。`,
        }),
      );
      return;
    }
    void handleSaveGroup();
  }, [draftGroupName, handleSaveGroup, isCreatingGroupAtLimit, t]);

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

    let shouldReloadAfterFailure = false;
    try {
      // 走 PATCH /note/:id/groups（review #59）—— 每条 note 只 1 个请求，没有 fetch detail
      // 也不需要把整张 note 的 title/content/media 全重发一遍。
      await runWithConcurrencyLimit(
        changedNotes,
        MEMBERSHIP_SAVE_CONCURRENCY,
        async (note) => {
          const currentGroupIds = note.groups.map((item) => item.id);
          const nextGroupIds = selectedNoteIds.has(note.id)
            ? [...new Set([...currentGroupIds, group.id])]
            : currentGroupIds.filter((id) => id !== group.id);

          await updateNoteGroupIds(note.id, nextGroupIds);
          shouldReloadAfterFailure = true;
        },
      );
      resetGroupMembershipEditor();
      await onMembershipsChanged();
    } catch (error) {
      setSavingMemberships(false);
      if (shouldReloadAfterFailure) {
        await onMembershipsChanged();
      }
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        shouldReloadAfterFailure
          ? t('notes.alerts.saveMembershipsPartialFailed', {
              defaultValue:
                '部分笔记分组可能已保存，列表已刷新为最新状态。请确认后重试。',
            })
          : t('notes.alerts.saveMembershipsFailed', {
              defaultValue: '笔记分组保存失败，请稍后再试。',
            }),
      );
      if (__DEV__) {
        console.warn('[GroupManagerSheet] saveGroupMemberships failed', error);
      }
    }
  }, [
    editingMembershipGroup,
    membershipNoteIds,
    notes,
    onMembershipsChanged,
    resetGroupMembershipEditor,
    savingMemberships,
    t,
  ]);

  const handleDeleteGroup = useCallback(
    (group: NoteGroup) => {
      Alert.alert(
        t('notes.alerts.deleteGroupTitle', { defaultValue: '删除分组' }),
        t('notes.alerts.deleteGroupMessage', {
          name: group.name,
          defaultValue: `删除"${group.name}"后不会删除笔记，只会移出该分组。`,
        }),
        [
          {
            text: t('common.cancel', { defaultValue: '取消' }),
            style: 'cancel',
          },
          {
            text: t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteNoteGroup(group.id);
                setGroups((prev) => prev.filter((item) => item.id !== group.id));
                onActiveGroupDeleted(group.id);
              } catch (error) {
                Alert.alert(
                  t('notes.alerts.deleteFailedTitle', {
                    defaultValue: '删除失败',
                  }),
                  t('notes.alerts.deleteGroupFailed', {
                    defaultValue: '分组删除失败，请稍后再试。',
                  }),
                );
                if (__DEV__) {
                  console.warn('[GroupManagerSheet] deleteNoteGroup failed', error);
                }
              }
            },
          },
        ],
      );
    },
    [onActiveGroupDeleted, setGroups, t],
  );

  const handleReorderGroups = useCallback(
    async (nextGroups: NoteGroup[], previousGroups: NoteGroup[]) => {
      setGroups(nextGroups);
      try {
        const orderedGroups = await reorderNoteGroups(
          nextGroups.map((group) => group.id),
        );
        setGroups(orderedGroups);
      } catch (error) {
        setGroups(previousGroups);
        Alert.alert(
          t('notes.alerts.reorderFailedTitle', { defaultValue: '排序失败' }),
          t('notes.alerts.reorderFailedMessage', {
            defaultValue: '分组顺序保存失败，请稍后再试。',
          }),
        );
        if (__DEV__) {
          console.warn('[GroupManagerSheet] reorderNoteGroups failed', error);
        }
      }
    },
    [setGroups, t],
  );

  const finishDrag = useCallback(() => {
    const meta = dragMetaRef.current;
    const finalRows = dragPreviewRowsRef.current ?? rowsRef.current;
    const previousRows = rowsRef.current;
    const changed = finalRows.some(
      (row, index) => row.id !== previousRows[index]?.id,
    );

    resetDragState();

    if (!meta || !changed) return;
    // 整条顺序（含「全部/未分组」的位置）落本地；分组间相对顺序变了才写服务端。
    setTabOrderIds(finalRows.map((row) => row.id));
    const nextGroups = finalRows.flatMap((row) => (row.group ? [row.group] : []));
    const previousGroups = previousRows.flatMap((row) =>
      row.group ? [row.group] : [],
    );
    const groupOrderChanged = nextGroups.some(
      (group, index) => group.id !== previousGroups[index]?.id,
    );
    if (groupOrderChanged) {
      void handleReorderGroups(nextGroups, previousGroups);
    }
  }, [handleReorderGroups, resetDragState, setTabOrderIds]);

  const getDragResponder = useCallback(
    (rowId: string) => {
      const cached = dragRespondersRef.current.get(rowId);
      if (cached) return cached;

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          const currentRows = rowsRef.current;
          const startIndex = currentRows.findIndex((row) => row.id === rowId);
          if (startIndex < 0) return;
          dragMetaRef.current = {
            rowId,
            startIndex,
            activeIndex: startIndex,
          };
          setDraggingRowId(rowId);
          const nextPreviewRows = [...currentRows];
          setDragPreviewRows(nextPreviewRows);
          dragPreviewRowsRef.current = nextPreviewRows;
          dragY.setValue(0);
        },
        onPanResponderMove: (_, gestureState) => {
          const meta = dragMetaRef.current;
          if (!meta) return;
          const source = dragPreviewRowsRef.current ?? rowsRef.current;
          const nextIndex = Math.max(
            0,
            Math.min(
              source.length - 1,
              Math.round(
                (meta.startIndex * GROUP_ROW_HEIGHT + gestureState.dy) /
                  GROUP_ROW_HEIGHT,
              ),
            ),
          );

          if (nextIndex !== meta.activeIndex) {
            const nextRows = [...source];
            const [moved] = nextRows.splice(meta.activeIndex, 1);
            nextRows.splice(nextIndex, 0, moved);
            meta.activeIndex = nextIndex;
            dragPreviewRowsRef.current = nextRows;
            setDragPreviewRows(nextRows);
          }

          dragY.setValue(
            gestureState.dy -
              (meta.activeIndex - meta.startIndex) * GROUP_ROW_HEIGHT,
          );
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });

      dragRespondersRef.current.set(rowId, responder);
      return responder;
    },
    [dragY, finishDrag],
  );

  const d = useMemo(
    () => ({
      screen: { backgroundColor: colors.background },
      modalTitle: { color: colors.text },
      modalCopy: { color: colors.textSecondary },
      limitText: { color: colors.textSecondary },
      // 全屏页底是 background，行卡片翻成 surface 才立得出来。
      groupRow: { backgroundColor: colors.surface },
      groupName: { color: colors.text },
      groupCount: { color: colors.textSecondary },
      // 之前 borderColor 用了 surface（与面板同色 = 隐形）。改成可见边框 +
      // background 凹槽底，让输入框在面板上明显立出来。
      modalInput: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      modalActionText: { color: colors.textSecondary },
      saveBtn: { backgroundColor: colors.primary },
      saveBtnText: { color: colors.white },
      searchWrap: { backgroundColor: colors.surface },
      searchInput: { color: colors.text },
      searchPlaceholder: colors.textSecondary,
      statsText: { color: colors.textSecondary },
    }),
    [colors],
  );

  const toggleMembershipNoteCard = useCallback(
    (note: NoteSummary) => toggleMembershipNote(note.id),
    [toggleMembershipNote],
  );

  // 完整笔记卡片（与列表页同款：封面/元信息/备注/来源），勾选态复用 NoteCard 多选模式。
  const renderMembershipNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard
        note={item}
        onPress={toggleMembershipNoteCard}
        showActions={false}
        selectionMode
        selected={selectedMembershipNoteIds.has(item.id)}
      />
    ),
    [selectedMembershipNoteIds, toggleMembershipNoteCard],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View
        style={[
          s.screen,
          d.screen,
          {
            paddingTop: insets.top + Spacing.sm,
            paddingBottom: insets.bottom + Spacing.sm,
          },
        ]}
      >
        <KeyboardAvoidingView
          style={s.flexFill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {editingMembershipGroup ? (
            <>
              <View style={s.membershipHeader}>
                <Pressable onPress={resetGroupMembershipEditor} hitSlop={8}>
                  <Ionicons name="chevron-back" size={22} color={colors.text} />
                </Pressable>
                <Text style={[s.modalTitle, d.modalTitle]}>
                  {t('notes.membership.selectTitle', {
                    defaultValue: '选择笔记',
                  })}
                </Text>
              </View>
              <Text style={[s.modalCopy, d.modalCopy]}>
                {t('notes.membership.copy', {
                  name: editingMembershipGroup.name,
                  defaultValue: `为"${editingMembershipGroup.name}"选择要加入的笔记。`,
                })}
              </Text>
              <View style={[s.membershipSearchWrap, d.searchWrap]}>
                <Ionicons
                  name="search-outline"
                  size={16}
                  color={d.searchPlaceholder}
                />
                <TextInput
                  style={[s.searchInput, d.searchInput]}
                  placeholder={t('notes.membership.searchPlaceholder', {
                    defaultValue: '搜索笔记',
                  })}
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
                ItemSeparatorComponent={() => (
                  <View
                    style={[
                      s.membershipSeparator,
                      { backgroundColor: colors.divider },
                    ]}
                  />
                )}
        {...keyboardDismissOnDragProps}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={[s.emptyText, d.statsText]}>
                    {notes.length === 0
                      ? t('notes.membership.empty', {
                          defaultValue: '暂无可选择的笔记',
                        })
                      : t('notes.empty.noMatch', {
                          defaultValue: '没有匹配的笔记',
                        })}
                  </Text>
                }
              />
              <View style={s.modalButtons}>
                <Pressable onPress={resetGroupMembershipEditor}>
                  <Text style={[s.modalActionText, d.modalActionText]}>
                    {t('common.back', { defaultValue: '返回' })}
                  </Text>
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
                    {savingMemberships
                      ? t('notes.membership.saving', {
                          defaultValue: '保存中...',
                        })
                      : t('notes.membership.saveSelection', {
                          defaultValue: '保存选择',
                        })}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={s.screenHeader}>
                <Text style={[s.modalTitle, d.modalTitle]}>
                  {t('notes.manageGroups.title', { defaultValue: '管理分组' })}
                </Text>
                <Pressable
                  onPress={handleClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close', { defaultValue: '关闭' })}
                >
                  <Ionicons name="close" size={24} color={colors.text} />
                </Pressable>
              </View>
              <Text style={[s.modalCopy, d.modalCopy]}>
                {t('notes.manageGroups.copy', {
                  defaultValue:
                    '全部和未分组也可拖动排序，但不能改名或删除。',
                })}
              </Text>
              <Text style={[s.limitText, d.limitText]}>
                {t('notes.manageGroups.limitHint', {
                  count: groups.length,
                  max: MAX_NOTE_GROUPS,
                  defaultValue: `已创建 ${groups.length}/${MAX_NOTE_GROUPS} 个分组`,
                })}
              </Text>
              <ScrollView
                style={s.modalList}
                contentContainerStyle={s.modalListContent}
                scrollEnabled={!draggingRowId}
                {...keyboardDismissOnDragProps}
              >
                {displayRows.map((row) => {
                  const isDragging = draggingRowId === row.id;
                  const group = row.group;
                  const name = group
                    ? group.name
                    : row.id === NOTES_TAB_ALL
                      ? t('notes.manageGroups.fixedAll', { defaultValue: '全部' })
                      : t('notes.manageGroups.fixedUngrouped', {
                          defaultValue: '未分组',
                        });
                  const count = group
                    ? group.noteCount
                    : row.id === NOTES_TAB_ALL
                      ? notes.length
                      : ungroupedCount;
                  return (
                    <Animated.View
                      key={row.id}
                      style={[
                        s.groupRow,
                        d.groupRow,
                        isDragging
                          ? {
                              transform: [{ translateY: dragY }],
                              zIndex: 2,
                              opacity: 0.98,
                            }
                          : draggingRowId
                            ? s.groupRowDimmed
                            : null,
                      ]}
                    >
                      <View style={s.groupRowLeft}>
                        <View
                          {...getDragResponder(row.id).panHandlers}
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
                          <Text style={[s.groupName, d.groupName]}>{name}</Text>
                          <Text style={[s.groupCount, d.groupCount]}>
                            {t('notes.manageGroups.noteCount', {
                              count,
                              defaultValue: `${count} 条笔记`,
                            })}
                          </Text>
                        </View>
                      </View>
                      {group ? (
                        <View style={s.groupRowActions}>
                          <Pressable
                            hitSlop={8}
                            onPress={() => openGroupMembershipEditor(group)}
                          >
                            <Ionicons
                              name="list-outline"
                              size={18}
                              color={colors.textSecondary}
                            />
                          </Pressable>
                          <Pressable
                            hitSlop={8}
                            onPress={() => openRenameGroupEditor(group)}
                          >
                            <Ionicons
                              name="create-outline"
                              size={18}
                              color={colors.textSecondary}
                            />
                          </Pressable>
                          <Pressable
                            hitSlop={8}
                            onPress={() => handleDeleteGroup(group)}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color={colors.textSecondary}
                            />
                          </Pressable>
                        </View>
                      ) : null}
                    </Animated.View>
                  );
                })}
              </ScrollView>
              <Pressable
                style={[s.addGroupBtn, d.saveBtn]}
                onPress={openCreateGroupEditor}
                accessibilityRole="button"
              >
                <Ionicons name="add" size={20} color={colors.white} />
                <Text style={[s.saveBtnText, d.saveBtnText]}>
                  {t('notes.manageGroups.createNew', {
                    defaultValue: '新增分组',
                  })}
                </Text>
              </Pressable>
            </>
          )}
        </KeyboardAvoidingView>
      </View>

      {/* 新增/改名共用的弹出编辑 sheet：常驻输入框已移除，弹起即聚焦。 */}
      <BottomSheetModal
        visible={groupEditorOpen}
        onClose={closeGroupEditor}
        backdropStyle={{ backgroundColor: colors.overlay }}
        sheetStyle={s.editorSheetWrap}
      >
        <KeyboardAvoidingView
          style={s.editorKav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              s.editorSheet,
              {
                backgroundColor: colors.surface,
                paddingBottom: insets.bottom || Spacing.lg,
              },
            ]}
          >
            <View
              style={[s.editorHandle, { backgroundColor: colors.surfaceBorder }]}
            />
            <View style={s.editorTitleBlock}>
              <Text style={[s.modalTitle, d.modalTitle]}>
                {editingGroupId
                  ? t('notes.manageGroups.renameTitle', {
                      defaultValue: '编辑名称',
                    })
                  : t('notes.manageGroups.createNew', {
                      defaultValue: '新增分组',
                    })}
              </Text>
              <Text style={[s.editorHint, d.modalCopy]}>
                {editingGroupId
                  ? t('notes.manageGroups.renameHint', {
                      name: editingGroupName,
                      defaultValue: `正在重命名「${editingGroupName}」`,
                    })
                  : t('notes.manageGroups.createHint', {
                      defaultValue: '分组帮你归类笔记。',
                    })}
              </Text>
            </View>
            <View style={s.editorField}>
              <Text style={[s.editorFieldLabel, d.modalCopy]}>
                {t('notes.manageGroups.nameLabel', { defaultValue: '分组名称' })}
              </Text>
              <TextInput
                ref={groupNameInputRef}
                style={[s.modalInput, d.modalInput]}
                placeholder={t('notes.manageGroups.namePlaceholder', {
                  defaultValue: '输入分组名添加新的分组',
                })}
                placeholderTextColor={colors.textSecondary}
                value={draftGroupName}
                onChangeText={setDraftGroupName}
                maxLength={GROUP_NAME_MAX_LENGTH}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSubmitGroupPress}
              />
              <Text style={[s.editorCharCount, d.modalCopy]}>
                {draftGroupName.length}/{GROUP_NAME_MAX_LENGTH}
              </Text>
            </View>
            <View style={s.editorSpacer} />
            <Pressable
              style={[
                s.editorPrimaryBtn,
                d.saveBtn,
                savingGroup ? s.saveBtnDisabled : null,
              ]}
              onPress={handleSubmitGroupPress}
              disabled={savingGroup}
              accessibilityRole="button"
            >
              <Text style={[s.saveBtnText, d.saveBtnText]}>
                {savingGroup
                  ? t('notes.manageGroups.saving', {
                      defaultValue: '保存中...',
                    })
                  : editingGroupId
                    ? t('notes.manageGroups.saveEdit', {
                        defaultValue: '保存修改',
                      })
                    : t('notes.manageGroups.createNew', {
                        defaultValue: '新增分组',
                      })}
              </Text>
            </Pressable>
            <Pressable
              style={s.editorCancelBtn}
              onPress={closeGroupEditor}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[s.modalActionText, d.modalActionText]}>
                {t('common.cancel', { defaultValue: '取消' })}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </BottomSheetModal>
    </Modal>
  );
}

const s = StyleSheet.create({
  // 全屏页：不再是底部弹层。
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  flexFill: {
    flex: 1,
    gap: Spacing.md,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  modalTitle: { ...Typography.h3, fontWeight: '700' },
  modalCopy: { ...Typography.small },
  limitText: { ...Typography.small, marginTop: -Spacing.xs },
  modalList: { flex: 1 },
  modalListContent: { gap: Spacing.sm, paddingBottom: Spacing.md },
  // NoteCard 自带左右 Spacing.lg 内边距：负 margin 抵掉全屏页的水平留白，卡片全宽。
  membershipList: { flex: 1, marginHorizontal: -Spacing.lg },
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
  searchInput: { flex: 1, ...Typography.bodyRegular },
  membershipSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
  },
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
  addGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 48,
    borderRadius: Radius.pill,
    marginTop: Spacing.sm,
  },
  // 编辑 sheet 占约半屏，弹出感更足；内容自顶向下排布。
  editorSheetWrap: { width: '100%', minHeight: '50%' },
  editorKav: { flex: 1 },
  editorSheet: {
    flex: 1,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  editorHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  editorTitleBlock: { gap: Spacing.xs, marginTop: Spacing.xs },
  editorHint: { ...Typography.small },
  editorField: { gap: Spacing.xs, marginTop: Spacing.sm },
  editorFieldLabel: { ...Typography.small, fontWeight: '600' },
  editorCharCount: { ...Typography.small, alignSelf: 'flex-end' },
  editorSpacer: { flex: 1 },
  editorPrimaryBtn: {
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorCancelBtn: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
  },
  // 明显的胶囊输入：可见边框 + 凹槽底 + 轻阴影，一眼看出是可输入区域。
  modalInput: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Typography.bodyRegular,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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
  emptyText: {
    textAlign: 'center',
    paddingTop: Spacing.xl,
    ...Typography.bodyRegular,
  },
});
