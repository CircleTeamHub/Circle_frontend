import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useDeferredContent } from '@/hooks/use-deferred-content';
import { useChatStore } from '@/chat-core/store';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { useGroupEditor } from '@/features/messages/hooks/use-group-editor';
import { GroupEditForm } from '@/features/messages/components/group-edit-form';
import { GroupMemberRow } from '@/features/messages/components/group-member-row';
import { GroupMemberToolbar } from '@/features/messages/components/group-member-toolbar';
import {
  filterConversationMembers,
  toggleFilteredConversationMembers,
  type ConversationMemberFilter,
} from '@/features/messages/utils/conversation-member-filter';
import type { Conversation } from '@/types';

const s = StyleSheet.create({
  header: { gap: Spacing.lg, paddingBottom: Spacing.sm },
  saveText: { ...Typography.body, fontWeight: '600' },
  empty: { ...Typography.bodyRegular, textAlign: 'center', paddingVertical: Spacing.lg },
  deleteButton: {
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  deleteText: { ...Typography.body, fontWeight: '600' },
});

const conversationKey = (conversation: Conversation) => conversation.id;

export default function GroupEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const editor = useGroupEditor(typeof params.id === 'string' && params.id ? params.id : null);
  const { setConversationIDs } = editor;
  const contentReady = useDeferredContent();
  const leaveAllowedRef = useRef(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConversationMemberFilter>('all');
  const rawConversations = useChatStore((state) => state.conversations);
  const conversations = useMemo(() => rawConversations.map(mapChatConversationToUI), [rawConversations]);
  const selectedIds = useMemo(() => new Set(editor.conversationIDs), [editor.conversationIDs]);
  const results = useMemo(
    () => filterConversationMembers(conversations, filter, query, selectedIds),
    [conversations, filter, query, selectedIds],
  );
  const allResultsSelected = results.length > 0 && results.every((c) => selectedIds.has(c.id));

  // 草稿没保存就离开（返回键 / 侧滑 / 安卓返回）先确认；保存或删除后放行。
  // 保存进行中不让走：否则保存成功后的 router.back() 会再退一层，把分组列表也关掉。
  // 先看放行：保存成功后 router.back() 触发拦截时，setSaving(false) 往往还没提交，
  // 这里拿到的仍是 saving=true 的闭包，先判 saving 会把这次正常退出吞掉。
  usePreventRemove(editor.dirty || editor.saving, ({ data }) => {
    if (leaveAllowedRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (editor.saving) return;
    Alert.alert(
      t('messages.groups.discardTitle', { defaultValue: '放弃这次修改？' }),
      t('messages.groups.discardMessage', { defaultValue: '修改还没有保存，离开后会丢失。' }),
      [
        { text: t('messages.groups.keepEditing', { defaultValue: '继续编辑' }), style: 'cancel' },
        {
          text: t('messages.groups.discard', { defaultValue: '放弃' }),
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  const leave = useCallback(() => {
    leaveAllowedRef.current = true;
    router.back();
  }, [router]);

  const { save, remove } = editor;
  const handleSave = useCallback(async () => {
    if (await save()) leave();
  }, [leave, save]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('messages.groups.deleteTitle', { defaultValue: '删除分组' }),
      t('messages.groups.deleteConfirm', {
        defaultValue: '确认删除「{{name}}」？分组内的会话不会被删除。',
        name: editor.savedName,
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: '删除' }),
          style: 'destructive',
          // 先退回列表再删：失败时 store 回滚、分组重新出现，并弹出提示。
          onPress: () => {
            leave();
            void remove();
          },
        },
      ],
    );
  }, [editor.savedName, leave, remove, t]);

  const toggleMember = useCallback(
    (id: string) =>
      setConversationIDs((current) =>
        current.includes(id) ? current.filter((cid) => cid !== id) : [...current, id],
      ),
    [setConversationIDs],
  );
  const toggleResults = useCallback(
    () =>
      setConversationIDs((current) =>
        toggleFilteredConversationMembers(current, results.map((c) => c.id), !allResultsSelected),
      ),
    [allResultsSelected, results, setConversationIDs],
  );

  const renderConversation = useCallback(
    ({ item }: { item: Conversation }) => (
      <GroupMemberRow
        conversation={item}
        checked={selectedIds.has(item.id)}
        disabled={editor.saving}
        onToggle={toggleMember}
      />
    ),
    [editor.saving, selectedIds, toggleMember],
  );

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
      content: { paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl },
      saveText: { color: colors.primary },
      saveTextDisabled: { color: colors.textSecondary },
      secondary: { color: colors.textSecondary },
      deleteButton: { backgroundColor: colors.surface },
      deleteText: { color: colors.error },
    }),
    [colors, insets.bottom, insets.top],
  );

  const title = editor.isNew
    ? t('messages.groups.create', { defaultValue: '新建分组' })
    : t('messages.groups.editTitle', { defaultValue: '编辑分组' });

  if (editor.missing) {
    return (
      <View style={d.container}>
        <NavHeader title={title} />
        <Text style={[s.empty, d.secondary]}>
          {t('messages.groups.notFound', { defaultValue: '这个分组已被删除' })}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingContainer style={d.container}>
      <NavHeader
        title={title}
        rightSlot={
          <Pressable
            onPress={handleSave}
            disabled={!editor.canSave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !editor.canSave }}
          >
            <Text style={[s.saveText, editor.canSave ? d.saveText : d.saveTextDisabled]}>
              {editor.saving
                ? t('common.saving', { defaultValue: '保存中...' })
                : editor.isNew
                  ? t('common.create', { defaultValue: '创建' })
                  : t('common.save', { defaultValue: '保存' })}
            </Text>
          </Pressable>
        }
      />
      <FlatList
        data={contentReady ? results : []}
        renderItem={renderConversation}
        keyExtractor={conversationKey}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        {...keyboardDismissOnDragProps}
        ListHeaderComponent={
          <View style={s.header}>
            <GroupEditForm
              name={editor.name}
              onChangeName={editor.setName}
              pinnedToTabs={editor.pinnedToTabs}
              onChangePinned={editor.setPinnedToTabs}
              autoFocus={editor.isNew}
              editable={!editor.saving}
            />
            <GroupMemberToolbar
              selectedCount={editor.conversationIDs.length}
              query={query}
              onChangeQuery={setQuery}
              filter={filter}
              onChangeFilter={setFilter}
              resultCount={results.length}
              allResultsSelected={allResultsSelected}
              onToggleResults={toggleResults}
              disabled={editor.saving}
            />
          </View>
        }
        ListEmptyComponent={
          contentReady ? (
            <Text style={[s.empty, d.secondary]}>
              {conversations.length === 0
                ? t('messages.groups.noConversations', { defaultValue: '暂无会话可加入' })
                : t('messages.groups.noMatchingConversations', { defaultValue: '没有匹配的会话' })}
            </Text>
          ) : null
        }
        ListFooterComponent={
          editor.isNew ? null : (
            <Pressable
              style={[s.deleteButton, d.deleteButton]}
              onPress={handleDelete}
              disabled={editor.saving}
              accessibilityRole="button"
            >
              <Text style={[s.deleteText, d.deleteText]}>
                {t('messages.groups.deleteTitle', { defaultValue: '删除分组' })}
              </Text>
            </Pressable>
          )
        }
      />
    </KeyboardAvoidingContainer>
  );
}
