import { Pressable, Text, View } from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { Ionicons } from '@expo/vector-icons';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Avatar } from '@/components/ui/avatar';
import { router } from 'expo-router';
import { getChatInfoTopHref, type UserProfileScope } from '@/features/user/utils/routes';
import { type EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { type ThemeColors } from '@/theme';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';

export interface ChatDetailHeaderProps {
  embedded: EmbeddedChatParams | undefined;
  colors: ThemeColors;
  scope: UserProfileScope;
  sourceID: string;
  conversationID: string;
  isTempChat: boolean;
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  handleBack: () => void;
  handleOpenHeaderTarget: () => void;
  headerStatusText: string;
  d: ChatDetailThemedStyles;
}

/**
 * 聊天页头部:返回键(桌面分栏内嵌时不显示)、会话头像与标题、在线/正在输入副标题、更多入口。
 */
export function ChatDetailHeader({
  embedded,
  colors,
  scope,
  sourceID,
  conversationID,
  isTempChat,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  handleBack,
  handleOpenHeaderTarget,
  headerStatusText,
  d,
}: ChatDetailHeaderProps) {
  return (
    <View style={s.header}>
      {embedded ? null : (
        <Pressable
          testID={E2E_TEST_IDS.chatBack}
          onPress={handleBack}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      )}
      <Pressable onPress={handleOpenHeaderTarget}>
        {isGroupChat ? (
          <GroupChatAvatar
            size={36}
            name={conversationTitle}
            uri={avatarUrl}
            temporary={isTempChat}
            badgeBorderColor={colors.background}
          />
        ) : (
          <Avatar size={36} name={conversationTitle} uri={avatarUrl} />
        )}
      </Pressable>
      <View style={s.headerInfo}>
        <View style={s.headerMeta}>
          <Text style={[s.headerName, d.headerName]}>{conversationTitle}</Text>
          {headerStatusText ? (
            <View style={s.onlineRow}>
              <View style={[s.onlineDot, d.onlineDot]} />
              <Text style={[s.headerStatusText, d.headerStatusText]}>
                {headerStatusText}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Pressable
        hitSlop={8}
        onPress={() =>
          router.push(
            getChatInfoTopHref(scope, {
              conversationID,
              sourceID,
              title: conversationTitle,
              conversationType: isGroupChat ? 'group' : 'private',
              originScope: scope,
            }),
          )
        }
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}
