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
import {
  forwardMessage,
  fromImUserId,
  sendFriendCardMessage,
  sendNoteCardMessage,
  sendTextMessage,
  sendVoiceMessageFromSource,
} from '@/im/client';
import { useIMStore } from '@/stores/imStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  SessionType,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import type { ChatMessage } from '@/types';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

type PendingForward = {
  message: ChatMessage;
  raw?: MessageItem;
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

function getConversationSource(conversation: ConversationItem) {
  if (conversation.conversationType === SessionType.Group) {
    return {
      sourceID: conversation.groupID,
      sessionType: SessionType.Group,
    };
  }

  return {
    sourceID: fromImUserId(conversation.userID),
    sessionType: SessionType.Single,
  };
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

async function sendForwardedMessage(
  pending: PendingForward,
  conversation: ConversationItem,
) {
  const { sourceID, sessionType } = getConversationSource(conversation);

  // Preferred path: forward the original OpenIM message natively. Preserves
  // images / video / files / custom cards without re-uploading. Only when the
  // raw item is unavailable (optimistic/local message) do we reconstruct below.
  if (pending.raw) {
    return forwardMessage({ sourceID, sessionType, message: pending.raw });
  }

  const { message } = pending;

  if (message.type === 'voice') {
    return sendVoiceMessageFromSource({
      sourceID,
      sessionType,
      sourceUrl: message.voiceUrl,
      soundPath: message.voicePath,
      duration: message.voiceDuration ?? 1,
      dataSize: message.voiceSize,
    });
  }

  if (message.type === 'note-card' && message.noteCard) {
    return sendNoteCardMessage({
      sourceID,
      sessionType,
      payload: message.noteCard,
    });
  }

  if (message.type === 'friend-card' && message.friendCard) {
    return sendFriendCardMessage({
      targetConversationID: conversation.conversationID,
      userID: message.friendCard.userID,
      nickname: message.friendCard.nickname,
      faceURL: message.friendCard.faceURL,
      persona: message.friendCard.persona,
      displayIcons: message.friendCard.displayIcons,
    });
  }

  const text = getForwardFallbackText(message);
  if (text) {
    return sendTextMessage({ sourceID, sessionType, text });
  }

  throw new Error('该消息类型暂不支持转发');
}

export default function ForwardPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const pending = useMessageForwardStore((state) => state.pending);
  const clearPending = useMessageForwardStore((state) => state.clear);
  const conversations = useIMStore((state) => state.conversations);
  const appendMessages = useIMStore((state) => state.appendMessages);
  const [query, setQuery] = useState('');
  const [sendingID, setSendingID] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) => {
      const name = conversation.showName?.toLowerCase() ?? '';
      return name.includes(keyword);
    });
  }, [conversations, query]);

  async function handleForward(conversation: ConversationItem) {
    if (!pending || sendingID) return;
    setSendingID(conversation.conversationID);
    try {
      const sent = await sendForwardedMessage(pending, conversation);
      appendMessages(conversation.conversationID, [sent]);
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
        keyExtractor={(item) => item.conversationID}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + Spacing.xl }]}
        {...keyboardDismissOnDragProps}
        renderItem={({ item }) => {
          const busy = sendingID === item.conversationID;
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
                name={item.showName}
                uri={item.faceURL || undefined}
              />
              <View style={s.rowText}>
                <Text style={d.title} numberOfLines={1}>
                  {item.showName}
                </Text>
                <Text style={d.subtitle} numberOfLines={1}>
                  {item.conversationType === SessionType.Group
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
