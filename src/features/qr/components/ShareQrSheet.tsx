import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { loadChatConversations } from '@/chat-core/api';
import { sendCardMessage } from '@/chat-core/client';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { useChatStore } from '@/chat-core/store';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { Conversation, QrCardData } from '@/types';

interface ShareQrSheetProps {
  /** 非空即打开;要分享的二维码卡片载荷(令牌 + 类型 + 名字 + 头像)。 */
  card: QrCardData | null;
  onClose: () => void;
}

/**
 * 把二维码作为**卡片消息**分享到某个私聊 / 群聊 —— 名片、群、圈子三种码共用。
 *
 * 早先发的是一张上传上去的 PNG:收方只看到孤零零一个黑白方块,不知道是谁的码、
 * 也不知道扫了会发生什么,还没法在同一台手机上扫自己的屏幕。改发 qr-card 之后,
 * 头像 / 名字 / 「这是什么码」都写在卡面上,码由收方就地按令牌渲染,点一下直接
 * 进落地页 —— 顺带把上传那条链路整个省了。
 */
export function ShareQrSheet({ card, onClose }: ShareQrSheetProps) {
  const visible = card != null;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const rawConversations = useChatStore((state) => state.conversations);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sendingId, setSendingId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // 关掉就清搜索词：否则下次打开还停在上次的过滤结果上，看着像「会话丢了」。
  useEffect(() => {
    if (!visible) setQuery('');
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
      hint: { color: colors.textSecondary },
      separator: { backgroundColor: colors.divider },
      // sheet 底已经是 surface，搜索框再用 surface 就糊在一起了 —— 用 background
      // 拉出一档对比（深色下更暗、浅色下更浅，两个主题都成立）。
      searchWrap: { backgroundColor: colors.background },
    }),
    [colors],
  );

  const send = useCallback(
    (conversation: Conversation) => {
      if (!card || inFlightRef.current) return;
      Alert.alert(
        t('qr.shareToChat.confirmTitle', { defaultValue: '发送二维码' }),
        t('qr.shareToChat.confirmMessage', {
          subject: card.name,
          name: conversation.name,
          defaultValue: `把「${card.name}」的二维码发送给 ${conversation.name}？`,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.send', { defaultValue: '发送' }),
            onPress: () => {
              if (inFlightRef.current) return;
              inFlightRef.current = true;
              setSendingId(conversation.id);
              void sendCardMessage({
                conversationId: conversation.id,
                type: 'qr-card',
                payload: card,
              })
                .then(() => {
                  if (!mountedRef.current) return;
                  onClose();
                  Alert.alert(
                    t('qr.shareToChat.sentTitle', { defaultValue: '已发送' }),
                    t('qr.shareToChat.sentMessage', {
                      defaultValue: '二维码已发送到聊天。',
                    }),
                  );
                })
                .catch(() => {
                  if (!mountedRef.current) return;
                  // 失败不给 error.message —— 那可能是上传/网络层的英文原文。
                  Alert.alert(
                    t('qr.shareToChat.failedTitle', { defaultValue: '发送失败' }),
                    t('qr.shareToChat.failedMessage', {
                      defaultValue: '二维码没能发出去，请稍后重试。',
                    }),
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
    [card, onClose, t],
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
            {sendingId === item.id
              ? t('qr.shareToChat.sending', { defaultValue: '发送中...' })
              : item.conversationType === 'group'
                ? t('qr.shareToChat.groupHint', { defaultValue: '群聊' })
                : t('qr.shareToChat.friendHint', { defaultValue: '好友' })}
          </Text>
        </View>
      </Pressable>
    ),
    [colors.background, d.hint, d.name, send, sendingId, t],
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
        {t('qr.shareToChat.title', { defaultValue: '分享给好友或群聊' })}
      </Text>
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : failed ? (
        <View style={s.center}>
          <Text style={[s.hint, d.hint]}>
            {t('qr.shareToChat.loadFailed', {
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
            {t('qr.shareToChat.empty', { defaultValue: '暂无可发送的聊天对象' })}
          </Text>
        </View>
      ) : (
        <>
          <View style={[s.searchWrap, d.searchWrap]}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={[s.searchInput, d.name]}
              placeholder={t('qr.shareToChat.searchPlaceholder', {
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
                {t('qr.shareToChat.noMatch', {
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
  searchInput: { flex: 1, ...Typography.bodyRegular, padding: 0 },
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
