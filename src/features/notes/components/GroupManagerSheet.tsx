import { Ionicons } from '@expo/vector-icons';
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
import { useTranslation } from 'react-i18next';
import {
  createNoteGroup,
  deleteNoteGroup,
  reorderNoteGroups,
  updateNoteGroup,
  updateNoteGroupIds,
} from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
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
const MAX_NOTE_GROUPS = 10;
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

  const displayGroups = dragPreviewGroups ?? groups;
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

  const handleClose = useCallback(() => {
    resetGroupDraft();
    resetGroupMembershipEditor();
    onClose();
  }, [onClose, resetGroupDraft, resetGroupMembershipEditor]);

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
    } catch (error) {
      setSavingGroup(false);
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        t('notes.alerts.saveGroupFailed', {
          defaultValue: '分组保存失败，请稍后再试。',
        }),
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
        },
      );
      resetGroupMembershipEditor();
      await onMembershipsChanged();
    } catch (error) {
      setSavingMemberships(false);
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        t('notes.alerts.saveMembershipsFailed', {
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
    async (nextGroups: NoteGroup[]) => {
      const previousGroups = groupsRef.current;
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
          const startIndex = groupsRef.current.findIndex(
            (group) => group.id === groupId,
          );
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
              Math.round(
                (meta.startIndex * GROUP_ROW_HEIGHT + gestureState.dy) /
                  GROUP_ROW_HEIGHT,
              ),
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
            gestureState.dy -
              (meta.activeIndex - meta.startIndex) * GROUP_ROW_HEIGHT,
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
      modalOverlay: { backgroundColor: 'rgba(0, 0, 0, 0.45)' as const },
      modalCard: { backgroundColor: colors.surface },
      modalTitle: { color: colors.text },
      modalCopy: { color: colors.textSecondary },
      limitText: { color: colors.textSecondary },
      groupRow: { backgroundColor: colors.background },
      groupName: { color: colors.text },
      groupCount: { color: colors.textSecondary },
      modalInput: { color: colors.text, borderColor: colors.surface },
      modalActionText: { color: colors.textSecondary },
      saveBtn: { backgroundColor: colors.primary },
      saveBtnText: { color: colors.white },
      membershipRowSelected: { borderColor: colors.primary },
      searchWrap: { backgroundColor: colors.surface },
      searchInput: { color: colors.text },
      searchPlaceholder: colors.textSecondary,
      statsText: { color: colors.textSecondary },
    }),
    [colors],
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={[s.modalOverlay, d.modalOverlay]} pointerEvents="box-none">
        <Pressable style={s.modalBackdrop} onPress={handleClose} />
        <View style={[s.modalCard, d.modalCard]}>
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
                  <View style={s.membershipSeparator} />
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
              <Text style={[s.modalTitle, d.modalTitle]}>
                {t('notes.manageGroups.title', { defaultValue: '管理分组' })}
              </Text>
              <Text style={[s.modalCopy, d.modalCopy]}>
                {t('notes.manageGroups.copy', {
                  defaultValue:
                    '"全部"和"未分组"固定在前面，常用自定义分组可以排在前面。',
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
                scrollEnabled={!draggingGroupId}
                {...keyboardDismissOnDragProps}
              >
                {displayGroups.map((group) => {
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
                          <Text style={[s.groupName, d.groupName]}>
                            {group.name}
                          </Text>
                          <Text style={[s.groupCount, d.groupCount]}>
                            {t('notes.manageGroups.noteCount', {
                              count: group.noteCount,
                              defaultValue: `${group.noteCount} 条笔记`,
                            })}
                          </Text>
                        </View>
                      </View>
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
                          onPress={() => {
                            setEditingGroupId(group.id);
                            setDraftGroupName(group.name);
                          }}
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
                    </Animated.View>
                  );
                })}
              </ScrollView>
              <View style={s.modalEditor}>
                <TextInput
                  ref={groupNameInputRef}
                  style={[s.modalInput, d.modalInput]}
                  placeholder={t('notes.manageGroups.namePlaceholder', {
                    defaultValue: '输入分组名，如上海',
                  })}
                  placeholderTextColor={colors.textSecondary}
                  value={draftGroupName}
                  onChangeText={setDraftGroupName}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmitGroupPress}
                />
                <View style={s.modalButtons}>
                  {editingGroupId ? (
                    <Pressable onPress={resetGroupDraft}>
                      <Text style={[s.modalActionText, d.modalActionText]}>
                        {t('notes.manageGroups.cancelEdit', {
                          defaultValue: '取消编辑',
                        })}
                      </Text>
                    </Pressable>
                  ) : (
                    <View />
                  )}
                  <Pressable
                    style={[
                      s.saveBtn,
                      d.saveBtn,
                      savingGroup ? s.saveBtnDisabled : null,
                    ]}
                    onPress={handleSubmitGroupPress}
                    disabled={savingGroup}
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
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
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
  limitText: { ...Typography.small, marginTop: -Spacing.xs },
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
  searchInput: { flex: 1, ...Typography.bodyRegular },
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
  emptyText: {
    textAlign: 'center',
    paddingTop: Spacing.xl,
    ...Typography.bodyRegular,
  },
});
