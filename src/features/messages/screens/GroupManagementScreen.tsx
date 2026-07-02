import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { useIMStore } from '@/stores/imStore';
import { mapConversationItemToUI } from '@/im/mappers';
import { getApiErrorMessage } from '@/services/api/errors';
import type { Conversation } from '@/types';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
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
  // Pattern D inFlightRef：建组 / 改名 / 改成员都是后端写，fast double-tap 必须挡。
  const createInFlightRef = useRef(false);
  const renameInFlightRef = useRef(false);

  const groups = useMessageGroupsStore((state) => state.groups);
  const loading = useMessageGroupsStore((state) => state.loading);
  const error = useMessageGroupsStore((state) => state.error);
  const loadGroups = useMessageGroupsStore((state) => state.load);
  const createGroup = useMessageGroupsStore((state) => state.create);
  const renameGroup = useMessageGroupsStore((state) => state.rename);
  const removeGroup = useMessageGroupsStore((state) => state.remove);
  const setMembers = useMessageGroupsStore((state) => state.setMembers);
  const setPinnedToTabs = useMessageGroupsStore((state) => state.setPinnedToTabs);
  const rawConversations = useIMStore((state) => state.conversations);

  // 真理源是 IM SDK 的会话列表；之前的 store 里的 conversations 是空数组，整个屏幕跑不通。
  const conversations = useMemo(
    () => rawConversations.map(mapConversationItemToUI),
    [rawConversations],
  );

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
        gap: Spacing.xl,
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
      const created = await createGroup({ name: trimmed });
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

  const handleToggleMember = useCallback(
    async (groupId: string, conversation: Conversation) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      const exists = group.conversationIDs.includes(conversation.id);
      const nextIDs = exists
        ? group.conversationIDs.filter((cid) => cid !== conversation.id)
        : [...group.conversationIDs, conversation.id];
      try {
        await setMembers(groupId, nextIDs);
      } catch (err) {
        Alert.alert(
          t('messages.groups.saveFailed', { defaultValue: '保存失败' }),
          getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
        );
      }
    },
    [groups, setMembers, t],
  );

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [activeGroupId, groups],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('messages.groups.title', { defaultValue: '自定义分组' })} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
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
            {t('messages.groups.myGroups', { defaultValue: '我的分组' })}
            {loading ? ` · ${t('common.loading', { defaultValue: '加载中…' })}` : ''}
            {error ? ` · ${error}` : ''}
          </Text>

          {!loading && groups.length === 0 ? (
            <Text style={[s.emptyText, d.emptyText]}>
              {t('messages.groups.empty', {
                defaultValue: '还没有自定义分组。建一个吧。',
              })}
            </Text>
          ) : null}

          {groups.map((group, index) => {
            const memberCount = group.conversationIDs.length;
            const selected = activeGroupId === group.id;
            return (
              <View key={group.id}>
                <Pressable
                  style={s.row}
                  onPress={() => setActiveGroupId(selected ? null : group.id)}
                  onLongPress={() => handleRename(group.id, group.name)}
                >
                  <Text style={d.rowLabel} numberOfLines={1}>
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
                    <Switch
                      value={group.pinnedToTabs}
                      onValueChange={(next) => handleTogglePinned(group.id, next)}
                      trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
                    />
                    <Ionicons
                      name={selected ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.textSecondary}
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
                  </View>
                </Pressable>
                {index < groups.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </View>

        {activeGroup ? (
          <View style={s.section}>
            <Text style={d.sectionTitle}>
              {t('messages.groups.memberHint', {
                defaultValue: '「{{name}}」的会话（长按分组名可改名）',
                name: activeGroup.name,
              })}
            </Text>
            {conversations.length === 0 ? (
              <Text style={[s.emptyText, d.emptyText]}>
                {t('messages.groups.noConversations', { defaultValue: '暂无会话可加入' })}
              </Text>
            ) : (
              conversations.map((conversation, index) => {
                const checked = activeGroup.conversationIDs.includes(
                  conversation.id,
                );
                return (
                  <View key={conversation.id}>
                    <Pressable
                      style={s.conversationRow}
                      onPress={() => handleToggleMember(activeGroup.id, conversation)}
                    >
                      <Avatar
                        size={36}
                        name={conversation.name}
                        uri={conversation.avatarUrl}
                      />
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
                    {index < conversations.length - 1 ? <Divider /> : null}
                  </View>
                );
              })
            )}
          </View>
        ) : null}
      </ScrollView>
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
