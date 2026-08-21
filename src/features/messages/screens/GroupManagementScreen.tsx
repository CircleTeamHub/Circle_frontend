import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { useChatStore } from '@/chat-core/store';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { getApiErrorMessage } from '@/services/api/errors';
import type { Conversation, CustomConversationGroup } from '@/types';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import {
  normalizeMessageFilterOrder,
  orderMessageFilters,
  reorderMessageFilter,
} from '@/features/messages/utils/message-filter-order';
import {
  filterConversationMembers,
  toggleFilteredConversationMembers,
  type ConversationMemberFilter,
} from '@/features/messages/utils/conversation-member-filter';

const FILTER_ORDER_ROW_HEIGHT = 52;
const GROUP_ORDER_ROW_HEIGHT = 56;

interface OrderableFilter {
  id: string;
  label: string;
  builtIn: boolean;
}

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  listHeader: {
    gap: Spacing.xl,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  groupRow: {
    marginHorizontal: -Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    minHeight: GROUP_ORDER_ROW_HEIGHT,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  orderHint: {
    ...Typography.small,
  },
  orderRow: {
    height: FILTER_ORDER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  orderRowDragging: {
    borderRadius: Radius.md,
    opacity: 0.98,
  },
  orderRowText: {
    flex: 1,
    ...Typography.body,
    fontWeight: '600',
  },
  orderRowType: {
    ...Typography.small,
  },
  dragHandle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  conversationMeta: {
    flex: 1,
    gap: 2,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  memberCount: {
    ...Typography.small,
    fontVariant: ['tabular-nums'],
  },
  searchBox: {
    height: 42,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    ...Typography.bodyRegular,
    paddingVertical: 0,
  },
  memberFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  memberFilterChip: {
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  memberFilterText: {
    ...Typography.caption,
  },
  bulkActionRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  bulkAction: {
    minHeight: 32,
    justifyContent: 'center',
  },
  bulkActionText: {
    ...Typography.caption,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
  },
  renameDialog: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  renameButton: {
    minWidth: 72,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  pendingHint: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    paddingVertical: Spacing.md,
    textAlign: 'center',
  },
});

export default function GroupManagementScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState<ConversationMemberFilter>('all');
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [draggingFilterId, setDraggingFilterId] = useState<string | null>(null);
  const [dragPreviewOrder, setDragPreviewOrder] = useState<string[] | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragPreviewGroups, setDragPreviewGroups] = useState<
    CustomConversationGroup[] | null
  >(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const groupDragY = useRef(new Animated.Value(0)).current;
  const dragPreviewOrderRef = useRef<string[] | null>(null);
  const dragPreviewGroupsRef = useRef<CustomConversationGroup[] | null>(null);
  const availableFilterItemsRef = useRef<OrderableFilter[]>([]);
  const filterOrderRef = useRef<string[]>([]);
  const groupsRef = useRef<CustomConversationGroup[]>([]);
  const dragMetaRef = useRef<{
    filterId: string;
    startIndex: number;
    activeIndex: number;
  } | null>(null);
  const dragRespondersRef = useRef(
    new Map<string, ReturnType<typeof PanResponder.create>>(),
  );
  const groupDragMetaRef = useRef<{
    groupId: string;
    startIndex: number;
    activeIndex: number;
  } | null>(null);
  const groupDragRespondersRef = useRef(
    new Map<string, ReturnType<typeof PanResponder.create>>(),
  );
  // Pattern D inFlightRef：建组 / 改名 / 改成员都是后端写，fast double-tap 必须挡。
  const createInFlightRef = useRef(false);
  const renameInFlightRef = useRef(false);
  const memberWriteInFlightRef = useRef(false);
  const groupReorderInFlightRef = useRef(false);

  const groups = useMessageGroupsStore((state) => state.groups);
  const filterOrder = useMessageGroupsStore((state) => state.filterOrder);
  const loading = useMessageGroupsStore((state) => state.loading);
  const error = useMessageGroupsStore((state) => state.error);
  const loadGroups = useMessageGroupsStore((state) => state.load);
  const createGroup = useMessageGroupsStore((state) => state.create);
  const renameGroup = useMessageGroupsStore((state) => state.rename);
  const removeGroup = useMessageGroupsStore((state) => state.remove);
  const setMembers = useMessageGroupsStore((state) => state.setMembers);
  const reorderGroups = useMessageGroupsStore((state) => state.reorder);
  const setPinnedToTabs = useMessageGroupsStore((state) => state.setPinnedToTabs);
  const setFilterOrder = useMessageGroupsStore((state) => state.setFilterOrder);
  const rawConversations = useChatStore((state) => state.conversations);

  // 真理源是 chat-core 的会话列表(MessagesScreen 已加载进 store)。
  const conversations = useMemo(
    () => rawConversations.map(mapChatConversationToUI),
    [rawConversations],
  );

  const availableFilterItems = useMemo<OrderableFilter[]>(
    () => [
      { id: 'all', label: t('messages.all'), builtIn: true },
      { id: 'unread', label: t('messages.unread'), builtIn: true },
      { id: 'group', label: t('messages.group'), builtIn: true },
      { id: 'private', label: t('messages.private'), builtIn: true },
      ...groups
        .filter((group) => group.pinnedToTabs)
        .map((group) => ({
          id: `custom:${group.id}`,
          label: group.name,
          builtIn: false,
        })),
    ],
    [groups, t],
  );
  const effectiveFilterOrder = dragPreviewOrder ?? filterOrder;
  const displayGroups = dragPreviewGroups ?? groups;
  const orderedFilterItems = useMemo(
    () => orderMessageFilters(availableFilterItems, effectiveFilterOrder),
    [availableFilterItems, effectiveFilterOrder],
  );
  const availableFilterKey = useMemo(
    () => availableFilterItems.map((item) => item.id).join('\n'),
    [availableFilterItems],
  );
  const groupIdsKey = useMemo(
    () => groups.map((group) => group.id).sort().join('\n'),
    [groups],
  );

  useEffect(() => {
    availableFilterItemsRef.current = availableFilterItems;
    filterOrderRef.current = normalizeMessageFilterOrder(
      availableFilterItems,
      filterOrder,
    );
  }, [availableFilterItems, filterOrder]);

  useEffect(() => {
    dragRespondersRef.current.clear();
  }, [availableFilterKey]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    groupDragRespondersRef.current.clear();
  }, [groupIdsKey]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      input: {
        flex: 1,
        height: 44,
        borderRadius: Radius.lg,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
        paddingHorizontal: Spacing.md,
        color: colors.text,
        ...Typography.bodyRegular,
      },
      createButton: {
        height: 44,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.lg,
        backgroundColor: colors.primary,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
      },
      createButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      rowLabel: {
        color: colors.text,
        ...Typography.body,
        flex: 1,
      },
      rowLabelSelected: {
        color: colors.primary,
        fontWeight: '700' as const,
      },
      groupRowSelected: {
        backgroundColor: colors.primaryLight,
      },
      rowValue: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      errorText: {
        color: colors.error,
        ...Typography.caption,
      },
      conversationName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      conversationSubtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      memberCount: {
        color: colors.textSecondary,
      },
      searchBox: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      searchInput: {
        color: colors.text,
      },
      memberFilterChip: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      memberFilterChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      memberFilterText: {
        color: colors.textSecondary,
      },
      memberFilterTextActive: {
        color: colors.white,
      },
      bulkActionText: {
        color: colors.primary,
      },
      renameTitle: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '700' as const,
      },
      renameCancelText: {
        color: colors.textSecondary,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      renameSaveButton: {
        backgroundColor: colors.primary,
      },
      renameSaveText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors, insets.bottom],
  );

  const handleCreate = useCallback(async () => {
    if (createInFlightRef.current) return;
    const trimmed = groupName.trim();
    if (!trimmed) {
      Alert.alert(t('messages.groups.nameRequired', { defaultValue: '请输入分组名称' }));
      return;
    }
    createInFlightRef.current = true;
    try {
      const created = await createGroup({ name: trimmed, pinnedToTabs: true });
      setGroupName('');
      setActiveGroupId(created.id);
    } catch (err) {
      Alert.alert(
        t('messages.groups.createFailed', { defaultValue: '创建失败' }),
        getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
    } finally {
      createInFlightRef.current = false;
    }
  }, [createGroup, groupName, t]);

  const closeRenameModal = useCallback(() => {
    if (renameInFlightRef.current) return;
    setRenameTarget(null);
    setRenameDraft('');
  }, []);

  const resetRenameModal = useCallback(() => {
    setRenameTarget(null);
    setRenameDraft('');
  }, []);

  const handleSubmitRename = useCallback(async () => {
    if (!renameTarget || renameInFlightRef.current) return;

    const next = renameDraft.trim();
    if (!next || next === renameTarget.name) {
      closeRenameModal();
      return;
    }

    renameInFlightRef.current = true;
    setRenameSubmitting(true);
    try {
      await renameGroup(renameTarget.id, next);
      resetRenameModal();
    } catch (err) {
      Alert.alert(
        t('messages.groups.renameFailed', { defaultValue: '重命名失败' }),
        getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
    } finally {
      renameInFlightRef.current = false;
      setRenameSubmitting(false);
    }
  }, [closeRenameModal, renameDraft, renameGroup, renameTarget, resetRenameModal, t]);

  const handleRename = useCallback(
    (id: string, currentName: string) => {
      if (typeof Alert.prompt !== 'function') {
        setRenameTarget({ id, name: currentName });
        setRenameDraft(currentName);
        return;
      }

      Alert.prompt(
        t('messages.groups.renameTitle', { defaultValue: '重命名分组' }),
        '',
        async (input) => {
          const next = (input ?? '').trim();
          if (!next || next === currentName) return;
          try {
            await renameGroup(id, next);
          } catch (err) {
            Alert.alert(
              t('messages.groups.renameFailed', { defaultValue: '重命名失败' }),
              getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
            );
          }
        },
        'plain-text',
        currentName,
      );
    },
    [renameGroup, t],
  );

  const handleDelete = useCallback(
    (id: string, name: string) => {
      Alert.alert(
        t('messages.groups.deleteTitle', { defaultValue: '删除分组' }),
        t('messages.groups.deleteConfirm', {
          defaultValue: '确认删除「{{name}}」？分组内的会话不会被删除。',
          name,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: async () => {
              try {
                if (activeGroupId === id) setActiveGroupId(null);
                await removeGroup(id);
              } catch (err) {
                Alert.alert(
                  t('messages.groups.deleteFailed', { defaultValue: '删除失败' }),
                  getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
                );
              }
            },
          },
        ],
      );
    },
    [activeGroupId, removeGroup, t],
  );

  const handleTogglePinned = useCallback(
    async (id: string, nextValue: boolean) => {
      try {
        await setPinnedToTabs(id, nextValue);
      } catch (err) {
        Alert.alert(
          t('messages.groups.saveFailed', { defaultValue: '保存失败' }),
          getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
        );
      }
    },
    [setPinnedToTabs, t],
  );

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [activeGroupId, groups],
  );

  const selectedConversationIDs = useMemo(
    () => new Set(activeGroup?.conversationIDs ?? []),
    [activeGroup?.conversationIDs],
  );

  const filteredConversations = useMemo(() => {
    if (!activeGroup) return [];
    return filterConversationMembers(
      conversations,
      memberFilter,
      memberQuery,
      selectedConversationIDs,
    );
  }, [activeGroup, conversations, memberFilter, memberQuery, selectedConversationIDs]);

  const memberFilterItems = useMemo(
    () => [
      {
        id: 'all' as const,
        label: t('messages.groups.filterAll', { defaultValue: '全部' }),
      },
      {
        id: 'group' as const,
        label: t('messages.groups.groupChat', { defaultValue: '群聊' }),
      },
      {
        id: 'private' as const,
        label: t('messages.groups.directChat', { defaultValue: '私聊' }),
      },
      {
        id: 'selected' as const,
        label: t('messages.groups.filterSelected', { defaultValue: '已选' }),
      },
    ],
    [t],
  );

  const allVisibleSelected =
    filteredConversations.length > 0 &&
    filteredConversations.every((conversation) =>
      selectedConversationIDs.has(conversation.id),
    );

  const commitMembers = useCallback(
    async (groupId: string, nextIDs: string[]) => {
      if (memberWriteInFlightRef.current) return;
      memberWriteInFlightRef.current = true;
      setMemberSubmitting(true);
      try {
        await setMembers(groupId, nextIDs);
      } catch (err) {
        Alert.alert(
          t('messages.groups.saveFailed', { defaultValue: '保存失败' }),
          getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
        );
      } finally {
        memberWriteInFlightRef.current = false;
        setMemberSubmitting(false);
      }
    },
    [setMembers, t],
  );

  const handleToggleMember = useCallback(
    (groupId: string, conversation: Conversation) => {
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group) return;
      const exists = group.conversationIDs.includes(conversation.id);
      const nextIDs = exists
        ? group.conversationIDs.filter((cid) => cid !== conversation.id)
        : [...group.conversationIDs, conversation.id];
      void commitMembers(groupId, nextIDs);
    },
    [commitMembers, groups],
  );

  const handleToggleVisibleMembers = useCallback(() => {
    if (!activeGroup || filteredConversations.length === 0) return;
    const nextIDs = toggleFilteredConversationMembers(
      activeGroup.conversationIDs,
      filteredConversations.map((conversation) => conversation.id),
      !allVisibleSelected,
    );
    void commitMembers(activeGroup.id, nextIDs);
  }, [activeGroup, allVisibleSelected, commitMembers, filteredConversations]);

  const handleSelectGroup = useCallback((id: string, selected: boolean) => {
    setActiveGroupId(selected ? null : id);
    setMemberQuery('');
    setMemberFilter('all');
  }, []);

  const renderConversation = useCallback(
    ({ item: conversation }: { item: Conversation }) => {
      if (!activeGroup) return null;
      const checked = selectedConversationIDs.has(conversation.id);
      return (
        <Pressable
          style={[s.conversationRow, memberSubmitting ? { opacity: 0.6 } : null]}
          onPress={() => handleToggleMember(activeGroup.id, conversation)}
          disabled={memberSubmitting}
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: memberSubmitting }}
        >
          {conversation.conversationType === 'group' ? (
            <GroupChatAvatar
              size={36}
              name={conversation.name}
              uri={conversation.avatarUrl}
              temporary={conversation.isTempChat}
              badgeBorderColor={colors.background}
            />
          ) : (
            <Avatar
              size={36}
              name={conversation.name}
              uri={conversation.avatarUrl}
            />
          )}
          <View style={s.conversationMeta}>
            <Text style={d.conversationName} numberOfLines={1}>
              {conversation.name}
            </Text>
            <Text style={d.conversationSubtitle} numberOfLines={1}>
              {conversation.conversationType === 'group'
                ? t('messages.groups.groupChat', { defaultValue: '群聊' })
                : t('messages.groups.directChat', { defaultValue: '私聊' })}
            </Text>
          </View>
          <Ionicons
            name={checked ? 'checkbox' : 'square-outline'}
            size={22}
            color={checked ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      );
    },
    [
      activeGroup,
      colors,
      d.conversationName,
      d.conversationSubtitle,
      handleToggleMember,
      memberSubmitting,
      selectedConversationIDs,
      t,
    ],
  );

  const resetDragState = useCallback(() => {
    dragMetaRef.current = null;
    dragPreviewOrderRef.current = null;
    dragY.stopAnimation();
    dragY.setValue(0);
    setDragPreviewOrder(null);
    setDraggingFilterId(null);
  }, [dragY]);

  const finishFilterDrag = useCallback(() => {
    const finalOrder = dragPreviewOrderRef.current ?? filterOrderRef.current;
    const changed = finalOrder.some(
      (id, index) => id !== filterOrderRef.current[index],
    );
    resetDragState();
    if (changed) setFilterOrder(finalOrder);
  }, [resetDragState, setFilterOrder]);

  const getFilterDragResponder = useCallback(
    (filterId: string) => {
      const cached = dragRespondersRef.current.get(filterId);
      if (cached) return cached;

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          const currentOrder = normalizeMessageFilterOrder(
            availableFilterItemsRef.current,
            filterOrderRef.current,
          );
          const startIndex = currentOrder.indexOf(filterId);
          if (startIndex < 0) return;

          dragMetaRef.current = {
            filterId,
            startIndex,
            activeIndex: startIndex,
          };
          dragPreviewOrderRef.current = currentOrder;
          setDragPreviewOrder(currentOrder);
          setDraggingFilterId(filterId);
          dragY.setValue(0);
        },
        onPanResponderMove: (_event, gestureState) => {
          const meta = dragMetaRef.current;
          if (!meta) return;
          const currentOrder =
            dragPreviewOrderRef.current ?? filterOrderRef.current;
          const nextIndex = Math.max(
            0,
            Math.min(
              currentOrder.length - 1,
              Math.round(
                (meta.startIndex * FILTER_ORDER_ROW_HEIGHT + gestureState.dy) /
                  FILTER_ORDER_ROW_HEIGHT,
              ),
            ),
          );

          if (nextIndex !== meta.activeIndex) {
            const nextOrder = reorderMessageFilter(
              currentOrder,
              filterId,
              nextIndex,
            );
            meta.activeIndex = nextIndex;
            dragPreviewOrderRef.current = nextOrder;
            setDragPreviewOrder(nextOrder);
          }

          dragY.setValue(
            gestureState.dy -
              (meta.activeIndex - meta.startIndex) * FILTER_ORDER_ROW_HEIGHT,
          );
        },
        onPanResponderRelease: finishFilterDrag,
        onPanResponderTerminate: finishFilterDrag,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });

      dragRespondersRef.current.set(filterId, responder);
      return responder;
    },
    [dragY, finishFilterDrag],
  );

  const moveFilterByOne = useCallback(
    (filterId: string, offset: number) => {
      const currentOrder = normalizeMessageFilterOrder(
        availableFilterItemsRef.current,
        filterOrderRef.current,
      );
      const currentIndex = currentOrder.indexOf(filterId);
      if (currentIndex < 0) return;
      setFilterOrder(
        reorderMessageFilter(currentOrder, filterId, currentIndex + offset),
      );
    },
    [setFilterOrder],
  );

  const resetGroupDragState = useCallback(() => {
    groupDragMetaRef.current = null;
    dragPreviewGroupsRef.current = null;
    groupDragY.stopAnimation();
    groupDragY.setValue(0);
    setDragPreviewGroups(null);
    setDraggingGroupId(null);
  }, [groupDragY]);

  const saveGroupOrder = useCallback(
    (groupIds: string[]) => {
      if (groupReorderInFlightRef.current) return;
      groupReorderInFlightRef.current = true;
      void reorderGroups(groupIds)
        .then(() => {
          const pinnedById = new Map(
            groupsRef.current.map((group) => [group.id, group.pinnedToTabs]),
          );
          const orderedCustomFilterIds = groupIds
            .filter((id) => pinnedById.get(id))
            .map((id) => `custom:${id}`);
          const currentFilterOrder = normalizeMessageFilterOrder(
            availableFilterItemsRef.current,
            filterOrderRef.current,
          );
          let customIndex = 0;
          const nextFilterOrder = currentFilterOrder.map((id) =>
            id.startsWith('custom:')
              ? (orderedCustomFilterIds[customIndex++] ?? id)
              : id,
          );
          if (
            nextFilterOrder.some(
              (id, index) => id !== currentFilterOrder[index],
            )
          ) {
            setFilterOrder(nextFilterOrder);
          }
        })
        .catch(() => {
          Alert.alert(
            t('messages.groups.reorderFailedTitle', {
              defaultValue: '排序失败',
            }),
            t('messages.groups.reorderFailedMessage', {
              defaultValue: '分组顺序保存失败，请稍后再试。',
            }),
          );
        })
        .finally(() => {
          groupReorderInFlightRef.current = false;
        });
    },
    [reorderGroups, setFilterOrder, t],
  );

  const finishGroupDrag = useCallback(() => {
    const finalGroups = dragPreviewGroupsRef.current ?? groupsRef.current;
    const changed = finalGroups.some(
      (group, index) => group.id !== groupsRef.current[index]?.id,
    );
    const groupIds = finalGroups.map((group) => group.id);
    resetGroupDragState();
    if (changed) saveGroupOrder(groupIds);
  }, [resetGroupDragState, saveGroupOrder]);

  const getGroupDragResponder = useCallback(
    (groupId: string) => {
      const cached = groupDragRespondersRef.current.get(groupId);
      if (cached) return cached;

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => !groupReorderInFlightRef.current,
        onMoveShouldSetPanResponder: () => !groupReorderInFlightRef.current,
        onMoveShouldSetPanResponderCapture: () =>
          !groupReorderInFlightRef.current,
        onPanResponderGrant: () => {
          if (groupReorderInFlightRef.current) return;
          const currentGroups = groupsRef.current;
          const startIndex = currentGroups.findIndex(
            (group) => group.id === groupId,
          );
          if (startIndex < 0) return;

          groupDragMetaRef.current = {
            groupId,
            startIndex,
            activeIndex: startIndex,
          };
          dragPreviewGroupsRef.current = currentGroups;
          setDragPreviewGroups(currentGroups);
          setDraggingGroupId(groupId);
          groupDragY.setValue(0);
        },
        onPanResponderMove: (_event, gestureState) => {
          const meta = groupDragMetaRef.current;
          if (!meta) return;
          const currentGroups =
            dragPreviewGroupsRef.current ?? groupsRef.current;
          const nextIndex = Math.max(
            0,
            Math.min(
              currentGroups.length - 1,
              Math.round(
                (meta.startIndex * GROUP_ORDER_ROW_HEIGHT + gestureState.dy) /
                  GROUP_ORDER_ROW_HEIGHT,
              ),
            ),
          );

          if (nextIndex !== meta.activeIndex) {
            const nextGroups = [...currentGroups];
            const currentIndex = nextGroups.findIndex(
              (group) => group.id === groupId,
            );
            if (currentIndex < 0) return;
            const [moved] = nextGroups.splice(currentIndex, 1);
            nextGroups.splice(nextIndex, 0, moved);
            meta.activeIndex = nextIndex;
            dragPreviewGroupsRef.current = nextGroups;
            setDragPreviewGroups(nextGroups);
          }

          groupDragY.setValue(
            gestureState.dy -
              (meta.activeIndex - meta.startIndex) * GROUP_ORDER_ROW_HEIGHT,
          );
        },
        onPanResponderRelease: finishGroupDrag,
        onPanResponderTerminate: finishGroupDrag,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });

      groupDragRespondersRef.current.set(groupId, responder);
      return responder;
    },
    [finishGroupDrag, groupDragY],
  );

  const moveGroupByOne = useCallback(
    (groupId: string, offset: number) => {
      if (groupReorderInFlightRef.current) return;
      const currentGroups = groupsRef.current;
      const currentIndex = currentGroups.findIndex(
        (group) => group.id === groupId,
      );
      if (currentIndex < 0) return;
      const nextIndex = Math.max(
        0,
        Math.min(currentGroups.length - 1, currentIndex + offset),
      );
      if (nextIndex === currentIndex) return;
      const nextGroups = [...currentGroups];
      const [moved] = nextGroups.splice(currentIndex, 1);
      nextGroups.splice(nextIndex, 0, moved);
      saveGroupOrder(nextGroups.map((group) => group.id));
    },
    [saveGroupOrder],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('messages.groups.title', { defaultValue: '自定义分组' })} />
      <FlatList
        data={filteredConversations}
        renderItem={renderConversation}
        keyExtractor={(conversation) => conversation.id}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!draggingFilterId && !draggingGroupId}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        {...keyboardDismissOnDragProps}
        ListHeaderComponent={
          <View style={s.listHeader}>
            <View style={s.section}>
              <Text style={d.sectionTitle}>
                {t('messages.groups.createSection', { defaultValue: '创建分组' })}
              </Text>
              <View style={s.inputRow}>
                <TextInput
                  style={d.input}
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder={t('messages.groups.namePlaceholder', {
                    defaultValue: '例如：家人 / 工作',
                  })}
                  placeholderTextColor={colors.textSecondary}
                  maxLength={32}
                  autoCorrect={false}
                />
                <Pressable style={d.createButton} onPress={handleCreate}>
                  <Text style={d.createButtonText}>
                    {t('common.create', { defaultValue: '创建' })}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={s.section}>
              <Text style={d.sectionTitle}>
                {t('messages.groups.orderSection', { defaultValue: '分组排序' })}
              </Text>
              <Text style={[s.orderHint, { color: colors.textSecondary }]}>
                {t('messages.groups.orderHint', {
                  defaultValue: '按住右侧拖动，消息页会按这个顺序显示',
                })}
              </Text>
              {orderedFilterItems.map((item, index) => {
                const isDragging = draggingFilterId === item.id;
                return (
                  <Animated.View
                    key={item.id}
                    style={[
                      s.orderRow,
                      { borderBottomColor: colors.divider },
                      isDragging
                        ? [
                            s.orderRowDragging,
                            {
                              backgroundColor: colors.surface,
                              transform: [{ translateY: dragY }],
                              zIndex: 2,
                            },
                          ]
                        : null,
                    ]}
                  >
                    <Text
                      style={[s.orderRowText, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    <Text style={[s.orderRowType, { color: colors.textSecondary }]}>
                      {item.builtIn
                        ? t('messages.groups.builtInGroup', { defaultValue: '固定' })
                        : t('messages.groups.customGroup', {
                            defaultValue: '自定义',
                          })}
                    </Text>
                    <View
                      style={s.dragHandle}
                      accessible
                      accessibilityRole="adjustable"
                      accessibilityLabel={t('messages.groups.reorderA11y', {
                        defaultValue: '调整「{{name}}」的位置',
                        name: item.label,
                      })}
                      accessibilityValue={{
                        text: `${index + 1} / ${orderedFilterItems.length}`,
                      }}
                      accessibilityActions={[
                        {
                          name: 'decrement',
                          label: t('messages.groups.moveUp', {
                            defaultValue: '上移',
                          }),
                        },
                        {
                          name: 'increment',
                          label: t('messages.groups.moveDown', {
                            defaultValue: '下移',
                          }),
                        },
                      ]}
                      onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === 'decrement') {
                          moveFilterByOne(item.id, -1);
                        } else if (event.nativeEvent.actionName === 'increment') {
                          moveFilterByOne(item.id, 1);
                        }
                      }}
                      {...getFilterDragResponder(item.id).panHandlers}
                    >
                      <Ionicons
                        name="reorder-three-outline"
                        size={24}
                        color={colors.textSecondary}
                      />
                    </View>
                  </Animated.View>
                );
              })}
            </View>

            <View style={s.section}>
              <Text style={d.sectionTitle}>
                {t('messages.groups.myGroups', { defaultValue: '我的分组' })}
                {loading
                  ? ` · ${t('common.loading', { defaultValue: '加载中…' })}`
                  : ''}
                {error ? ` · ${error}` : ''}
              </Text>

              {!loading && groups.length === 0 ? (
                <Text style={[s.emptyText, d.emptyText]}>
                  {t('messages.groups.empty', {
                    defaultValue: '还没有自定义分组。建一个吧。',
                  })}
                </Text>
              ) : null}

              {displayGroups.map((group, index) => {
                const memberCount = group.conversationIDs.length;
                const selected = activeGroupId === group.id;
                const isDragging = draggingGroupId === group.id;
                return (
                  <Animated.View
                    key={group.id}
                    style={
                      isDragging
                        ? {
                            transform: [{ translateY: groupDragY }],
                            zIndex: 2,
                          }
                        : null
                    }
                  >
                    <Pressable
                      style={[
                        s.row,
                        s.groupRow,
                        selected ? d.groupRowSelected : null,
                        isDragging ? { backgroundColor: colors.surface } : null,
                      ]}
                      onPress={() => handleSelectGroup(group.id, selected)}
                      onLongPress={() => handleRename(group.id, group.name)}
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[d.rowLabel, selected ? d.rowLabelSelected : null]}
                        numberOfLines={1}
                      >
                        {group.name}
                      </Text>
                      <View style={s.rowRight}>
                        <Text style={d.rowValue}>
                          {t('messages.groups.conversationCount', {
                            defaultValue: '{{count}} 个会话',
                            count: memberCount,
                          })}
                        </Text>
                        {/* pinnedToTabs 开关：决定该分组是否在 MessagesScreen 顶部 tab 显示 */}
                        <ThemedSwitch
                          value={group.pinnedToTabs}
                          onValueChange={(next) =>
                            handleTogglePinned(group.id, next)
                          }
                        />
                        <Ionicons
                          name={selected ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={selected ? colors.primary : colors.textSecondary}
                        />
                        <Pressable
                          onPress={() => handleDelete(group.id, group.name)}
                          hitSlop={8}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={colors.error}
                          />
                        </Pressable>
                        <View
                          style={s.dragHandle}
                          accessible
                          accessibilityRole="adjustable"
                          accessibilityLabel={t('messages.groups.reorderA11y', {
                            defaultValue: '调整「{{name}}」的位置',
                            name: group.name,
                          })}
                          accessibilityValue={{
                            text: `${index + 1} / ${displayGroups.length}`,
                          }}
                          accessibilityActions={[
                            {
                              name: 'decrement',
                              label: t('messages.groups.moveUp', {
                                defaultValue: '上移',
                              }),
                            },
                            {
                              name: 'increment',
                              label: t('messages.groups.moveDown', {
                                defaultValue: '下移',
                              }),
                            },
                          ]}
                          onAccessibilityAction={(event) => {
                            if (event.nativeEvent.actionName === 'decrement') {
                              moveGroupByOne(group.id, -1);
                            } else if (
                              event.nativeEvent.actionName === 'increment'
                            ) {
                              moveGroupByOne(group.id, 1);
                            }
                          }}
                          {...getGroupDragResponder(group.id).panHandlers}
                        >
                          <Ionicons
                            name="reorder-three-outline"
                            size={24}
                            color={colors.textSecondary}
                          />
                        </View>
                      </View>
                    </Pressable>
                    {index < displayGroups.length - 1 ? <Divider /> : null}
                  </Animated.View>
                );
              })}
            </View>

            {activeGroup ? (
              <View style={[s.section, { paddingBottom: Spacing.sm }]}>
                <View style={s.memberHeaderRow}>
                  <Text style={[d.sectionTitle, { flex: 1 }]}>
                    {t('messages.groups.memberHint', {
                      defaultValue: '选择要加入「{{name}}」的群聊或私聊（可多选）',
                      name: activeGroup.name,
                    })}
                  </Text>
                  <Text style={[s.memberCount, d.memberCount]}>
                    {t('messages.groups.selectedCount', {
                      defaultValue: '已选 {{selected}} / {{total}}',
                      selected: activeGroup.conversationIDs.length,
                      total: conversations.length,
                    })}
                  </Text>
                </View>

                <View style={[s.searchBox, d.searchBox]}>
                  <Ionicons
                    name="search-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[s.searchInput, d.searchInput]}
                    value={memberQuery}
                    onChangeText={setMemberQuery}
                    placeholder={t('messages.groups.searchPlaceholder', {
                      defaultValue: '搜索群聊或私聊',
                    })}
                    placeholderTextColor={colors.textSecondary}
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {memberQuery ? (
                    <Pressable
                      onPress={() => setMemberQuery('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>

                <View style={s.memberFilters} accessibilityRole="tablist">
                  {memberFilterItems.map((item) => {
                    const selected = memberFilter === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        style={[
                          s.memberFilterChip,
                          d.memberFilterChip,
                          selected ? d.memberFilterChipActive : null,
                        ]}
                        onPress={() => setMemberFilter(item.id)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                      >
                        <Text
                          style={[
                            s.memberFilterText,
                            d.memberFilterText,
                            selected ? d.memberFilterTextActive : null,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={s.bulkActionRow}>
                  <Text style={[s.memberCount, d.memberCount]}>
                    {t('messages.groups.resultCount', {
                      defaultValue: '{{count}} 个结果',
                      count: filteredConversations.length,
                    })}
                  </Text>
                  <Pressable
                    style={s.bulkAction}
                    onPress={handleToggleVisibleMembers}
                    disabled={memberSubmitting || filteredConversations.length === 0}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        s.bulkActionText,
                        d.bulkActionText,
                        memberSubmitting || filteredConversations.length === 0
                          ? { opacity: 0.5 }
                          : null,
                      ]}
                    >
                      {allVisibleSelected
                        ? t('messages.groups.deselectResults', {
                            defaultValue: '取消当前结果',
                          })
                        : t('messages.groups.selectResults', {
                            defaultValue: '选择全部结果',
                          })}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          activeGroup ? (
            <Text style={[s.emptyText, d.emptyText]}>
              {conversations.length === 0
                ? t('messages.groups.noConversations', {
                    defaultValue: '暂无会话可加入',
                  })
                : t('messages.groups.noMatchingConversations', {
                    defaultValue: '没有匹配的会话',
                  })}
            </Text>
          ) : null
        }
      />
      <Modal
        visible={renameTarget != null}
        transparent
        animationType="fade"
        onRequestClose={closeRenameModal}
      >
        <View style={s.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeRenameModal} />
          <View style={[s.renameDialog, { backgroundColor: colors.surface }]}>
            <Text style={d.renameTitle}>
              {t('messages.groups.renameTitle', { defaultValue: '重命名分组' })}
            </Text>
            <TextInput
              style={d.input}
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholderTextColor={colors.textSecondary}
              maxLength={32}
              autoCorrect={false}
              autoFocus
              editable={!renameSubmitting}
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={handleSubmitRename}
            />
            <View style={s.renameActions}>
              <Pressable
                style={s.renameButton}
                onPress={closeRenameModal}
                disabled={renameSubmitting}
              >
                <Text style={d.renameCancelText}>
                  {t('common.cancel', { defaultValue: '取消' })}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  s.renameButton,
                  d.renameSaveButton,
                  renameSubmitting ? { opacity: 0.6 } : null,
                ]}
                onPress={handleSubmitRename}
                disabled={renameSubmitting}
              >
                <Text style={d.renameSaveText}>
                  {t('common.save', { defaultValue: '保存' })}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
