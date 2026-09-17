import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { memo, type ReactElement, useCallback } from 'react';
import { type ChatMessage } from '@/types';
import { type GestureResponderEvent, Pressable, View } from 'react-native';
import { MemberName } from '@/components/ui/member-name';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import {
  CallRecordBubble,
  CircleCardBubble,
  DatePill,
  FriendCardBubble,
  ImageBubble,
  LocationCard,
  NoteCardBubble,
  PlazaPostCardBubble,
  QrCardBubble,
  ReceivedBubble,
  SentBubble,
  SystemNoticePill,
  TransferCardBubble,
  VerificationCardBubble,
  VideoBubble,
  VoiceBubble,
} from '@/features/chat/components/chat-bubble';
import { router } from 'expo-router';
import {
  getCircleDetailHref,
  getNoteDetailHref,
  getPlazaPostDetailHref,
  getQrLandingHref,
  getVerificationDetailHref,
  type UserProfileScope,
} from '@/features/user/utils/routes';
import { type ThemeColors } from '@/theme';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';

interface MessageRowProps {
  item: ChatMessage;
  renderMessage: (item: ChatMessage) => ReactElement | null;
}

/**
 * 一行消息。按 item 与渲染函数记忆:新消息插到最前面时后面每个单元格的 index 都变,
 * FlatList 的单元格会整体重渲染;挡在这一层,气泡只在自己的消息对象换了时才渲染。
 */
const MessageRow = memo(function MessageRow({
  item,
  renderMessage,
}: MessageRowProps) {
  return renderMessage(item);
});

export interface MessageRendererParams {
  colors: ThemeColors;
  scope: UserProfileScope;
  groupMemberNames: Record<string, string>;
  selfDestructEnabled: boolean;
  selfDestructCacheKey: string;
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  handleOpenMessageSender: (msg: ChatMessage) => Promise<void>;
  handleOpenUserCard: (userID: string, nickname?: string) => Promise<void>;
  hideChatAvatar: boolean;
  d: ChatDetailThemedStyles;
  highlightedMessageID: string | null;
  handleQuotePress: (item: ChatMessage) => void;
  selfAvatarUri: string | undefined;
  selfName: string | undefined;
  handleToggleReaction: (message: ChatMessage, emoji: string) => void;
  getMessageLongPressHandler: (message: ChatMessage) => (event: GestureResponderEvent) => void;
  handleStartCall: () => void;
}

/**
 * 消息列表的行渲染(FlatList renderItem):按消息类型选气泡,群聊接收消息带发送者名字,
 * 包一层长按菜单与定位高亮。
 */
export function useMessageRenderer({
  colors,
  scope,
  groupMemberNames,
  selfDestructEnabled,
  selfDestructCacheKey,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  handleOpenMessageSender,
  handleOpenUserCard,
  hideChatAvatar,
  d,
  highlightedMessageID,
  handleQuotePress,
  selfAvatarUri,
  selfName,
  handleToggleReaction,
  getMessageLongPressHandler,
  handleStartCall,
}: MessageRendererParams) {
  // 群聊接收消息的显示名：本地备注覆盖 > 群成员权威昵称 > 消息自带昵称 > 会话标题。
  // 群成员昵称排在消息自带 senderNickname 之前——后者可能为空而回落成原始 hex id，
  // 成员表里的昵称才是能稳定显示的「对方名字」。
  const allRemarkOverrides = useFriendRemarkStore((state) => state.remarks);
  const receivedDisplayName = useCallback(
    (msg: ChatMessage) => {
      const override = msg.senderID
        ? allRemarkOverrides[msg.senderID]
        : undefined;
      const memberName = msg.senderID
        ? groupMemberNames[msg.senderID]
        : undefined;
      return (
        override?.remark || memberName || msg.senderName || conversationTitle
      );
    },
    [allRemarkOverrides, groupMemberNames, conversationTitle],
  );

  // 群聊头像用发送者本人的（新消息自带最新头像）；单聊沿用会话头像参数。
  const receivedAvatarUri = useCallback(
    (msg: ChatMessage) =>
      isGroupChat ? msg.senderAvatarUrl : (avatarUrl ?? msg.senderAvatarUrl),
    [isGroupChat, avatarUrl],
  );

  // 群聊在接收气泡上方显示发送者名字（微信样式）。senderID 仅接收消息携带。
  const withGroupSenderLabel = useCallback(
    (message: ChatMessage, node: ReactElement): ReactElement => {
      if (!isGroupChat || !message.senderID) {
        return node;
      }
      return (
        <View>
          <MemberName
            name={receivedDisplayName(message)}
            userId={message.senderID}
            style={[
              s.senderLabel,
              hideChatAvatar && s.senderLabelWithoutAvatarColumn,
              { color: colors.textSecondary },
            ]}
          />
          {node}
        </View>
      );
    },
    [isGroupChat, receivedDisplayName, colors.textSecondary, hideChatAvatar],
  );

  const withMessageActions = useCallback(
    (message: ChatMessage, node: ReactElement) => (
      <Pressable
        style={
          message.id === highlightedMessageID
            ? [s.targetMessageHighlight, d.targetMessageHighlight]
            : undefined
        }
        onLongPress={getMessageLongPressHandler(message)}
        delayLongPress={350}
      >
        {withGroupSenderLabel(message, node)}
      </Pressable>
    ),
    [
      d.targetMessageHighlight,
      getMessageLongPressHandler,
      highlightedMessageID,
      withGroupSenderLabel,
    ],
  );

  const renderMessage = useCallback((item: ChatMessage) => {
    switch (item.type) {
      case 'date': return <DatePill text={item.text ?? ''} />;
      case 'system-notice': return <SystemNoticePill text={item.text ?? ''} />;
      case 'received':
        return withMessageActions(item, (
          <ReceivedBubble
            message={item}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            onAvatarPress={() => handleOpenMessageSender(item)}
            onQuotePress={
              item.quoteMessageId && !item.quoteRevoked
                ? () => handleQuotePress(item)
                : undefined
            }
            onReactionPress={(emoji) => handleToggleReaction(item, emoji)}
          />
        ));
      case 'sent':
        return withMessageActions(item, (
          <SentBubble
            message={item}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            hideStatus={isGroupChat}
            onQuotePress={
              item.quoteMessageId && !item.quoteRevoked
                ? () => handleQuotePress(item)
                : undefined
            }
            onReactionPress={(emoji) => handleToggleReaction(item, emoji)}
          />
        ));
      case 'location':
        return withMessageActions(item, (
          <LocationCard
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
          />
        ));
      case 'image':
        return withMessageActions(item, (
          <ImageBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
            selfDestructEnabled={selfDestructEnabled}
            selfDestructCacheKey={selfDestructCacheKey}
          />
        ));
      case 'video':
        return withMessageActions(item, (
          <VideoBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
            selfDestructEnabled={selfDestructEnabled}
          />
        ));
      case 'voice':
        return withMessageActions(item, (
          <VoiceBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'note-card':
        return withMessageActions(item, (
          <NoteCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(note) =>
              router.push(getNoteDetailHref(scope, note.noteId, note.ownerId ?? ''))
            }
            onSectionPress={(note, section) =>
              router.push(getNoteDetailHref(scope, note.noteId, note.ownerId ?? '', section))
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'friend-card':
        return withMessageActions(item, (
          <FriendCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(card) => handleOpenUserCard(card.userID, card.nickname)}
            hideStatus={isGroupChat}
          />
        ));
      case 'circle-card':
        return withMessageActions(item, (
          <CircleCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(card) =>
              // 在当前栈内打开圈子详情（从哪进从哪出），不跨 tab 压栈。
              router.push(
                getCircleDetailHref(
                  scope === 'discover' ? 'discover' : 'messages',
                  card.circleId,
                ),
              )
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'qr-card':
        return withMessageActions(item, (
          <QrCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            // 点卡片 = 扫这张码:走扫码同一条落地页,由落地页按令牌自己判类型与有效性。
            // 进本栈那一份镜像,不能跳顶层 /qr:本页在四个 tab 栈和 (chat) 下都有挂载
            // 点,而落地页自己还要往下跳(看资料 / 加好友 / 进群聊)—— 从顶层进去那些
            // 下一跳只会落回 messages 栈,把用户甩出他出发的 tab,返回也不是上一层。
            // 同理 push 不能改成 replace:顶掉当前页,落地页走完就没有可返回的上一层
            // 了,正是 #202 修掉的那个 bug。
            onPress={(card) => router.push(getQrLandingHref(scope, card.token))}
            hideStatus={isGroupChat}
          />
        ));
      case 'plaza-post-card':
        return withMessageActions(item, (
          <PlazaPostCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            onPress={(card) =>
              router.push(
                getPlazaPostDetailHref(
                  scope === 'discover' ? 'discover' : 'messages',
                  card.postId,
                ),
              )
            }
            hideStatus={isGroupChat}
          />
        ));
      case 'verification-card':
        return withGroupSenderLabel(item,
          <VerificationCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onPress={(card) =>
              router.push(
                getVerificationDetailHref(
                  scope === 'discover' ? 'discover' : 'messages',
                  card.invitationId,
                ),
              )
            }
            hideStatus={isGroupChat}
          />
        );
      case 'transfer-card':
        return withMessageActions(item, (
          <TransferCardBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        ));
      case 'call-record':
        return (
          <CallRecordBubble
            message={item}
            outgoing={Boolean(item.outgoing)}
            senderName={receivedDisplayName(item)}
            senderAvatarUri={receivedAvatarUri(item)}
            selfName={selfName}
            selfAvatarUri={selfAvatarUri}
            onAvatarPress={item.outgoing ? undefined : () => handleOpenMessageSender(item)}
            // 1:1 里点通话记录 = 回拨；群聊回拨走标题栏通话入口，避免误触发全群振铃。
            onCallBack={isGroupChat ? undefined : handleStartCall}
            onLongPress={getMessageLongPressHandler(item)}
            hideStatus={isGroupChat}
          />
        );
      default: return null;
    }
  }, [
    receivedAvatarUri,
    receivedDisplayName,
    withGroupSenderLabel,
    handleOpenMessageSender,
    handleOpenUserCard,
    handleQuotePress,
    handleToggleReaction,
    isGroupChat,
    selfDestructCacheKey,
    selfDestructEnabled,
    selfAvatarUri,
    selfName,
    scope,
    getMessageLongPressHandler,
    withMessageActions,
    handleStartCall,
  ]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageRow item={item} renderMessage={renderMessage} />
    ),
    [renderMessage],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return {
    renderItem,
    keyExtractor,
  };
}
