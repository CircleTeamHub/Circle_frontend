import { Pressable, Text, View } from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { Ionicons } from '@expo/vector-icons';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Avatar } from '@/components/ui/avatar';
import { AssistantFloatingHeader } from '@/features/assistant/components/AssistantFloatingHeader';
import { router } from 'expo-router';
import { getChatInfoTopHref, type UserProfileScope } from '@/features/user/utils/routes';
import { type ChatSheetActions, type EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { type ThemeColors } from '@/theme';
import { useTranslation } from 'react-i18next';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';

export interface ChatDetailHeaderProps {
  embedded: EmbeddedChatParams | undefined;
  /** 半屏快捷聊天:左边是关闭,右边是展开成完整聊天页。 */
  sheet?: ChatSheetActions;
  colors: ThemeColors;
  scope: UserProfileScope;
  sourceID: string;
  conversationID: string;
  isTempChat: boolean;
  isAssistant: boolean;
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  handleBack: () => void;
  handleOpenHeaderTarget: () => void;
  headerStatusText: string;
  assistantSpinning?: boolean;
  d: ChatDetailThemedStyles;
}

/**
 * 聊天页头部:返回键(桌面分栏内嵌时不显示)、会话头像与标题、在线/正在输入副标题、更多入口。
 */
export function ChatDetailHeader({
  embedded,
  sheet,
  colors,
  scope,
  sourceID,
  conversationID,
  isTempChat,
  isAssistant,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  handleBack,
  handleOpenHeaderTarget,
  headerStatusText,
  assistantSpinning = false,
  d,
}: ChatDetailHeaderProps) {
  const { t } = useTranslation();
  if (isAssistant) {
    return (
      <AssistantFloatingHeader
        onBack={sheet ? sheet.onClose : embedded ? undefined : handleBack}
        spinning={assistantSpinning}
        title={conversationTitle}
      />
    );
  }

  return (
    <View style={s.header}>
      {sheet ? (
        <Pressable
          onPress={sheet.onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      ) : embedded ? null : (
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
      {sheet ? (
        <Pressable
          hitSlop={8}
          onPress={sheet.onExpand}
          accessibilityRole="button"
          accessibilityLabel={t('chat.quickChat.expand', { defaultValue: '展开完整聊天' })}
        >
          <Ionicons name="expand-outline" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : isAssistant ? null : (
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
      )}
    </View>
  );
}
