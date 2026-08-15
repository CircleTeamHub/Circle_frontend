import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '@/i18n';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import { loadChatConversations } from '@/chat-core/api';
import {
  sendCardMessage,
  sendImageMessage,
  sendVideoMessage,
  sendLocationMessage,
  sendTextMessage,
  sendVoiceMessage,
  type ChatCardType,
} from '@/chat-core/client';
import { useChatStore } from '@/chat-core/store';
import type { ChatConversationDto, ChatMessageDto } from '@/chat-core/protocol';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ChatMessage } from '@/types';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

type PendingForward = {
  message: ChatMessage;
  dto?: ChatMessageDto;
};

const s = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    minHeight: 52,
    borderRadius: Radius.md,
  },
  searchInput: {
    flex: 1,
    ...Typography.bodyRegular,
    lineHeight: 20,
    minHeight: 24,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  row: {
    minHeight: 68,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rowText: { flex: 1, gap: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
});

// 可直接按原 payload 重发的卡片类型 —— 即客户端本来就能发的那几种(ChatCardType)。
// 回执类一律排除:transfer-card / verification-card 都是服务端签发的凭证,
// 原样转发等于伪造一笔转账、或伪造一份验证邀请;它们在后端也只认服务端写入,
// 客户端重发必被拒。转账卡保留文本降级形态,验证卡连长按菜单都不提供
// (见 ChatDetailScreen 的 'verification-card' 分支:没有 withMessageActions)。
// 广场报名卡同样排除:它只由报名列表定向创建,不提供二次扩散入口。
const FORWARDABLE_CARD_TYPES: ChatCardType[] = [
  'note-card',
  'friend-card',
  'circle-card',
];

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function conversationDisplayName(conversation: ChatConversationDto): string {
  return (
    conversation.circle?.name ??
    conversation.peer?.nickname ??
    i18n.t('chat.forward.single', { defaultValue: '单聊' })
  );
}

function conversationAvatarUrl(conversation: ChatConversationDto): string | undefined {
  return (
    str(conversation.circle?.avatarUrl ?? undefined) ??
    str(conversation.peer?.avatarUrl ?? undefined)
  );
}

/**
 * 这条消息能不能转发 —— 菜单和转发页共用同一个判定,不能各判各的。
 *
 * 之前长按任何消息都提供「转发」,而 call-record 在转发页既没有分支也没有兜底文案,
 * 必走到最后那个 throw;catch 提示「请重试」,可重试永远不会成功。
 * 通话记录本身也没有转发语义(它是一次通话在本会话里的留痕),所以直接不提供入口。
 */
export function canForwardMessage(message: ChatMessage): boolean {
  if (message.type === 'call-record') return false;
  if (message.type === 'system-notice') return false;
  return true;
}

function getForwardFallbackText(message: ChatMessage) {
  if (message.type === 'sent' || message.type === 'received') {
    return message.text?.trim() ?? '';
  }
  if (message.type === 'location') {
    return i18n
      .t('chat.forward.locationWithDetail', {
        detail: message.locationTitle ?? message.locationAddress ?? '',
        defaultValue: '[位置] {{detail}}',
      })
      .trim();
  }
  if (message.type === 'transfer-card') {
    return i18n
      .t('im.preview.transferWithAmount', {
        amount: message.transferCard?.amount ?? '',
        defaultValue: '[转账] {{amount}} 积分',
      })
      .trim();
  }
  return '';
}

/**
 * 转发 = 以源消息的 content 重发一条新消息(自研栈无「原生转发」原语)。
 * 媒体只搬 object key,不重新上传;拿不到 DTO 时退化成文本转发。
 */
async function sendForwardedMessage(pending: PendingForward, conversationId: string) {
  const { dto, message } = pending;
  const content = dto?.content ?? {};

  if (dto) {
    if (dto.type === 'image') {
      const key = str(content['key']);
      if (key) {
        return sendImageMessage({
          conversationId,
          key,
          thumbKey: str(content['thumbKey']),
          width: num(content['width']),
          height: num(content['height']),
        });
      }
    }
    if (dto.type === 'video') {
      const key = str(content['key']);
      if (key) {
        return sendVideoMessage({
          conversationId,
          key,
          width: num(content['width']),
          height: num(content['height']),
          duration: num(content['duration']),
          size: num(content['size']),
        });
      }
    }
    if (dto.type === 'voice') {
      const key = str(content['key']);
      const duration = num(content['duration']);
      if (key && duration) {
        return sendVoiceMessage({
          conversationId,
          key,
          duration,
          size: num(content['size']),
        });
      }
    }
    if (dto.type === 'location') {
      const latitude = num(content['latitude']);
      const longitude = num(content['longitude']);
      if (latitude !== undefined && longitude !== undefined) {
        return sendLocationMessage({
          conversationId,
          latitude,
          longitude,
          title: str(content['title']),
          address: str(content['address']),
          description: str(content['description']) ?? '',
        });
      }
    }
    if ((FORWARDABLE_CARD_TYPES as string[]).includes(dto.type)) {
      return sendCardMessage({
        conversationId,
        type: dto.type as ChatCardType,
        payload: content,
      });
    }
    if (dto.type === 'text' || dto.type === 'quote') {
      const text = str(content['text'])?.trim();
      if (text) {
        return sendTextMessage({ conversationId, text });
      }
    }
  }

  const text = getForwardFallbackText(message);
  if (text) {
    return sendTextMessage({ conversationId, text });
  }

  throw new Error(
    i18n.t('chat.forward.unsupported', { defaultValue: '该消息类型暂不支持转发' }),
  );
}

export default function ForwardPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const pending = useMessageForwardStore((state) => state.pending);
  const clearPending = useMessageForwardStore((state) => state.clear);
  const conversations = useChatStore((state) => state.conversations);
  const [query, setQuery] = useState('');
  const [sendingID, setSendingID] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (conversations.length > 0) return;
    loadChatConversations().catch((err) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[ForwardPicker] loadChatConversations failed', err);
      }
    });
  }, [conversations.length]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) =>
      conversationDisplayName(conversation).toLowerCase().includes(keyword),
    );
  }, [conversations, query]);

  async function handleForward(conversation: ChatConversationDto) {
    if (!pending || sendingID) return;
    setSendingID(conversation.id);
    try {
      // sendWithOptimism 已把发出的消息写进 chat-core store,无需手动 append。
      await sendForwardedMessage(pending, conversation.id);
      clearPending();
      if (!mountedRef.current) return;
      Alert.alert(t('chat.forward.done'), undefined, [
        {
          text: t('common.confirm'),
          onPress: () => router.back(),
        },
      ]);
    } catch (error) {
      if (__DEV__) {
        console.warn('[ForwardPicker] forward message failed', error);
      }
      if (!mountedRef.current) return;
      Alert.alert(t('chat.forward.failed'), t('chat.forward.failedRetry'));
    } finally {
      if (mountedRef.current) setSendingID(null);
    }
  }

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      searchWrap: {
        backgroundColor: colors.surface,
      },
      searchInput: {
        color: colors.text,
      },
      row: {
        backgroundColor: colors.surface,
      },
      title: {
        color: colors.text,
        ...Typography.body,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
    }),
    [colors, insets.top],
  );

  if (!pending) {
    return (
      <View style={[s.container, d.container]}>
        <NavHeader title={t('chat.forward.title')} />
        <View style={s.center}>
          <Text style={d.subtitle}>{t('chat.forward.empty')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, d.container]}>
      <NavHeader title={t('chat.forward.title')} />
      <View style={[s.searchWrap, d.searchWrap]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.searchInput]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.forward.searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + Spacing.xl }]}
        {...keyboardDismissOnDragProps}
        renderItem={({ item }) => {
          const busy = sendingID === item.id;
          const name = conversationDisplayName(item);
          return (
            <Pressable
              style={[s.row, d.row]}
              disabled={Boolean(sendingID)}
              onPress={() => {
                void handleForward(item);
              }}
            >
              <Avatar
                size={42}
                shape="square"
                name={name}
                uri={conversationAvatarUrl(item)}
              />
              <View style={s.rowText}>
                <Text style={d.title} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={d.subtitle} numberOfLines={1}>
                  {item.type === 'GROUP'
                    ? t('chat.forward.group')
                    : t('chat.forward.single')}
                </Text>
              </View>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
