import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { loadConversationList, sendNoteCardToConversation } from '@/im/client';
import { mapConversationItemToUI } from '@/im/mappers';
import { useIMStore } from '@/stores/imStore';
import type { Conversation, NoteCardData } from '@/types';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ShareNoteSheetProps {
  /** 非空即打开；要分享的笔记卡片数据 */
  payload: NoteCardData | null;
  onClose: () => void;
}

function getShareNoteSendErrorMessage(t: ReturnType<typeof useTranslation>['t']) {
  return t('notes.shareToChat.failedMessage', {
    defaultValue: 'Unable to send this note right now. Please try again.',
  });
}

/**
 * 分享笔记到聊天：选一个会话（好友或群聊），把笔记以卡片消息发过去，
 * 对方点卡片即可打开这条笔记。取代旧的系统分享面板 / 网页分享链接。
 */
export function ShareNoteSheet({ payload, onClose }: ShareNoteSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const visible = payload != null;

  const rawConversations = useIMStore((state) => state.conversations);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sendingId, setSendingId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
    loadConversationList()
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
    () => rawConversations.map(mapConversationItemToUI),
    [rawConversations],
  );

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      name: { color: colors.text },
      hint: { color: colors.textSecondary },
      separator: { backgroundColor: colors.divider },
    }),
    [colors],
  );

  const send = useCallback(
    (conversation: Conversation) => {
      if (!payload || inFlightRef.current) return;
      Alert.alert(
        t('notes.shareToChat.confirmTitle', { defaultValue: '发送笔记' }),
        t('notes.shareToChat.confirmMessage', {
          title: payload.title,
          name: conversation.name,
          defaultValue: `把「${payload.title}」发送给 ${conversation.name}？`,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.send', { defaultValue: '发送' }),
            onPress: () => {
              if (inFlightRef.current) return;
              inFlightRef.current = true;
              setSendingId(conversation.id);
              void sendNoteCardToConversation({
                targetConversationID: conversation.id,
                payload,
              })
                .then(() => {
                  if (!mountedRef.current) return;
                  onClose();
                  Alert.alert(
                    t('notes.shareToChat.sentTitle', { defaultValue: '已发送' }),
                    t('notes.shareToChat.sentMessage', {
                      defaultValue: '笔记已发送到聊天。',
                    }),
                  );
                })
                .catch(() => {
                  if (!mountedRef.current) return;
                  Alert.alert(
                    t('notes.shareToChat.failedTitle', { defaultValue: '发送失败' }),
                    getShareNoteSendErrorMessage(t),
                  );
                })
                .finally(() => {
                  inFlightRef.current = false;
                  if (mountedRef.current) setSendingId('');
                });
            },
          },
        ],
        { cancelable: true },
      );
    },
    [onClose, payload, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <Pressable
        style={s.row}
        onPress={() => send(item)}
        disabled={Boolean(sendingId)}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <Avatar
          size={44}
          name={item.name}
          uri={item.avatarUrl}
          shape={item.conversationType === 'group' ? 'square' : 'circle'}
        />
        <View style={s.rowText}>
          <Text style={[s.name, d.name]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[s.hint, d.hint]} numberOfLines={1}>
            {sendingId === item.id
              ? t('notes.shareToChat.sending', { defaultValue: '发送中...' })
              : item.conversationType === 'group'
                ? t('notes.shareToChat.groupHint', { defaultValue: '群聊' })
                : t('notes.shareToChat.friendHint', { defaultValue: '好友' })}
          </Text>
        </View>
      </Pressable>
    ),
    [d.hint, d.name, send, sendingId, t],
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
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={[s.separator, d.separator]} />}
          style={s.list}
          showsVerticalScrollIndicator={false}
        />
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
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  rowText: { flex: 1, gap: 2 },
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
