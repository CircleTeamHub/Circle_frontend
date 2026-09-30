import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { loadChatConversations } from '@/chat-core/api';
import { sendCardMessage } from '@/chat-core/client';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { useChatStore } from '@/chat-core/store';
import {
  noteSendWindowDelayMs,
  recordNoteSendAttempt,
} from '@/features/chat/utils/note-batch-send';
import type { Conversation, NoteCardData } from '@/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ShareNoteSheetProps {
  /** 非空数组即打开；要分享的笔记卡片数据（单条 = [payload]，多选分享传全部） */
  payloads: NoteCardData[] | null;
  onClose: () => void;
}

interface NoteCardSendTask {
  conversationId: string;
  payload: NoteCardData;
}

/**
 * 分享笔记到聊天：选择一个或多个会话（好友或群聊），把笔记以卡片消息发过去，
 * 对方点卡片即可打开这条笔记。取代旧的系统分享面板 / 网页分享链接。
 */
export function ShareNoteSheet({ payloads, onClose }: ShareNoteSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const targets = payloads && payloads.length > 0 ? payloads : null;
  const visible = targets != null;

  const rawConversations = useChatStore((state) => state.conversations);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [retryTasks, setRetryTasks] = useState<NoteCardSendTask[]>([]);
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const sendTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 关闭时重置搜索和选择，避免下次分享沿用上次收件人。
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setSelectedIds(new Set());
      setRetryTasks([]);
    }
  }, [visible]);

  // 打开时若没有缓存会话，拉一次列表。
  useEffect(() => {
    if (!visible) return;
    if (rawConversations.length > 0) {
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    loadChatConversations()
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, rawConversations.length, visible]);

  const conversations = useMemo(
    () => rawConversations.map(mapChatConversationToUI),
    [rawConversations],
  );

  // 会话多了以后靠滚动找人太慢：按名字就地过滤（大小写不敏感）。
  const trimmedQuery = query.trim().toLowerCase();
  const visibleConversations = useMemo(() => {
    if (!trimmedQuery) return conversations;
    return conversations.filter((item) =>
      item.name.toLowerCase().includes(trimmedQuery),
    );
  }, [conversations, trimmedQuery]);

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      name: { color: colors.text },
      hint: { color: colors.text },
      separator: { backgroundColor: colors.divider },
      // sheet 底已经是 surface，搜索框再用 surface 就糊在一起了 —— 用 background
      // 拉出一档对比（深色下更暗、浅色下更浅，两个主题都成立）。
      searchWrap: { backgroundColor: colors.background },
    }),
    [colors],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sendSelected = useCallback(() => {
    const isRetry = retryTasks.length > 0;
    if (!targets || (!isRetry && selectedIds.size === 0) || inFlightRef.current) return;
    const selectedConversations = conversations.filter((item) => selectedIds.has(item.id));
    if (!isRetry && selectedConversations.length === 0) return;
    const tasks = isRetry
      ? retryTasks
      : selectedConversations.flatMap((conversation) =>
          targets.map((payload) => ({ conversationId: conversation.id, payload })),
        );
    const recipientCount = new Set(tasks.map((task) => task.conversationId)).size;
    const confirmMessage = isRetry
      ? t('notes.shareToChat.confirmRetryMessage', {
          count: tasks.length,
          recipientCount,
          defaultValue: `仅重试之前发送失败的 ${tasks.length} 条内容（涉及 ${recipientCount} 个聊天对象）？已成功的内容不会重复发送。`,
        })
      : t('notes.shareToChat.confirmRecipientsMessage', {
          noteCount: targets.length,
          recipientCount,
          defaultValue: `把 ${targets.length} 条笔记发送给选中的 ${recipientCount} 个聊天对象？`,
        });
    Alert.alert(
      t('notes.shareToChat.confirmTitle', { defaultValue: '发送笔记' }),
      confirmMessage,
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.send', { defaultValue: '发送' }),
          onPress: () => {
            if (inFlightRef.current) return;
            inFlightRef.current = true;
            setSending(true);
            void (async () => {
              // 顺序发送并遵守聊天发送的 20 条/10s 限流。
              const failures: NoteCardSendTask[] = [];
              for (const task of tasks) {
                const delay = noteSendWindowDelayMs(sendTimestampsRef.current, Date.now());
                if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
                sendTimestampsRef.current = recordNoteSendAttempt(
                  sendTimestampsRef.current,
                  Date.now(),
                );
                try {
                  await sendCardMessage({
                    conversationId: task.conversationId,
                    type: 'note-card',
                    payload: task.payload,
                  });
                } catch {
                  failures.push(task);
                }
              }
              if (!mountedRef.current) return;
              if (failures.length === 0) {
                setRetryTasks([]);
                onClose();
                Alert.alert(
                  t('notes.shareToChat.sentTitle', { defaultValue: '已发送' }),
                  t('notes.shareToChat.sentRecipientsMessage', {
                    recipientCount,
                    defaultValue: `笔记已发送到 ${recipientCount} 个聊天对象。`,
                  }),
                );
              } else {
                setRetryTasks(failures);
                Alert.alert(
                  t('notes.shareToChat.failedTitle', { defaultValue: '发送失败' }),
                  t('notes.shareToChat.partialFailed', {
                    count: failures.length,
                    defaultValue: `有 ${failures.length} 条内容发送失败。重试时只会发送失败项。`,
                  }),
                );
              }
            })().finally(() => {
              inFlightRef.current = false;
              if (mountedRef.current) setSending(false);
            });
          },
        },
      ],
      { cancelable: true },
    );
  }, [conversations, onClose, retryTasks, selectedIds, targets, t]);

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <Pressable
        style={s.row}
        onPress={() => toggleSelected(item.id)}
        disabled={sending || retryTasks.length > 0}
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: selectedIds.has(item.id),
          disabled: sending || retryTasks.length > 0,
        }}
        accessibilityLabel={item.name}
      >
        {item.conversationType === 'group' ? (
          <GroupChatAvatar
            size={44}
            name={item.name}
            uri={item.avatarUrl}
            temporary={item.isTempChat}
            badgeBorderColor={colors.background}
          />
        ) : (
          <Avatar size={44} name={item.name} uri={item.avatarUrl} shape="circle" />
        )}
        <View style={s.rowText}>
          <Text style={[s.name, d.name]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[s.hint, d.hint]} numberOfLines={1}>
            {sending
              ? t('notes.shareToChat.sending', { defaultValue: '发送中...' })
              : item.conversationType === 'group'
                ? t('notes.shareToChat.groupHint', { defaultValue: '群聊' })
                : t('notes.shareToChat.friendHint', { defaultValue: '好友' })}
          </Text>
        </View>
        <Ionicons
          name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
          size={23}
          color={selectedIds.has(item.id) ? colors.primary : colors.textSecondary}
        />
      </Pressable>
    ),
    [
      colors.background,
      colors.primary,
      colors.textSecondary,
      d.hint,
      d.name,
      selectedIds,
      sending,
      t,
      toggleSelected,
    ],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}
    >
      <View style={[s.handle, d.handle]} />
      <Text style={[s.title, d.title]}>
        {t('notes.shareToChat.title', { defaultValue: '分享给好友或群聊' })}
      </Text>
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : failed ? (
        <View style={s.center}>
          <Text style={[s.hint, d.hint]}>
            {t('notes.shareToChat.loadFailed', {
              defaultValue: '无法加载聊天对象，请稍后重试',
            })}
          </Text>
          <Pressable
            style={[s.retry, { borderColor: colors.surfaceBorder }]}
            onPress={() => setAttempt((current) => current + 1)}
          >
            <Text style={[Typography.body, { color: colors.primary }]}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        </View>
      ) : conversations.length === 0 ? (
        <View style={s.center}>
          <Text style={[s.hint, d.hint]}>
            {t('notes.shareToChat.empty', { defaultValue: '暂无可发送的聊天对象' })}
          </Text>
        </View>
      ) : (
        <>
          <View style={[s.searchWrap, d.searchWrap]}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={[s.searchInput, d.name]}
              placeholder={t('notes.shareToChat.searchPlaceholder', {
                defaultValue: '搜索好友或群聊',
              })}
              placeholderTextColor={colors.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query ? (
              <Pressable
                hitSlop={8}
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
              >
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {visibleConversations.length === 0 ? (
            // 搜不到 ≠ 没有会话：文案要分开，否则用户以为聊天列表空了。
            <View style={s.center}>
              <Text style={[s.hint, d.hint]}>
                {t('notes.shareToChat.noMatch', {
                  defaultValue: '没有匹配的好友或群聊',
                })}
              </Text>
            </View>
          ) : (
            <FlatList
              data={visibleConversations}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              ItemSeparatorComponent={() => <View style={[s.separator, d.separator]} />}
              style={s.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}
          <Pressable
            style={[
              s.sendButton,
              { backgroundColor: selectedIds.size ? colors.primary : colors.surfaceBorder },
            ]}
            onPress={sendSelected}
            disabled={selectedIds.size === 0 || sending}
            accessibilityRole="button"
          >
            <Text style={[Typography.body, { color: colors.white }]}>
              {sending
                ? t('notes.shareToChat.sending', { defaultValue: '发送中...' })
                : retryTasks.length > 0
                  ? t('notes.shareToChat.retryFailed', {
                      count: retryTasks.length,
                      defaultValue: `重试 ${retryTasks.length} 条失败内容`,
                    })
                  : t('notes.shareToChat.sendSelected', {
                      count: selectedIds.size,
                      defaultValue: `发送给 ${selectedIds.size} 个聊天对象`,
                    })}
            </Text>
          </Pressable>
        </>
      )}
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
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
  title: {
    ...Typography.h3,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.xxl,
  },
  searchInput: {
    flex: 1,
    ...Typography.bodyRegular,
    lineHeight: 20,
    minHeight: 24,
    padding: 0,
    textAlignVertical: 'center',
  },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  rowText: { flex: 1, gap: 2 },
  sendButton: {
    minHeight: 48,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...Typography.body, fontWeight: '600' },
  hint: { ...Typography.caption, fontWeight: '400' },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.lg + 44 + Spacing.md,
  },
  center: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  retry: {
    minWidth: 96,
    height: 36,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
