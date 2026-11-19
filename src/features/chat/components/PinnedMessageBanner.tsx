import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Pin } from 'lucide-react-native';
import type { ChatPinnedMessageDto } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { ScrollingAnnouncementBanner } from '@/components/ui/scrolling-announcement-banner';
import { PinnedMessagesSheet } from '@/features/chat/components/pinned-messages-sheet';
import { canManageChatPins } from '@/features/chat/utils/chat-pins';
import { Spacing } from '@/theme';

interface PinnedMessageBannerProps {
  conversationID: string;
  onJump: (messageId: string) => void;
}

const NO_PINS: ChatPinnedMessageDto[] = [];

/**
 * 聊天顶部的置顶横幅(所有人可见),跟群公告横幅同一个组件、同一个样子,排在公告下面。
 * 一个会话最多置顶 5 条(最新的在前):横幅显示最新的那条,多条时标签写「置顶 · 3 条」;
 * 跟点公告进详情一样,点它弹出全部置顶,在那里点哪条跳哪条,有权限的人逐条取消。
 */
export function PinnedMessageBanner({ conversationID, onJump }: PinnedMessageBannerProps) {
  const { t } = useTranslation();
  // 分开取:整个会话行每来一条消息都会换,横幅只关心置顶和权限。
  const pins = useChatStore(
    (state) => state.conversations.find((item) => item.id === conversationID)?.pinnedMessages ?? NO_PINS,
  );
  const canManage = useChatStore((state) => {
    const conversation = state.conversations.find((item) => item.id === conversationID);
    return conversation ? canManageChatPins(conversation) : false;
  });
  const [listOpen, setListOpen] = useState(false);
  if (pins.length === 0) return null;

  const preview = pins[0].preview || t('chat.pin.fallbackPreview', { defaultValue: '[消息]' });
  const tag = pins.length > 1
    ? t('chat.pin.listTitle', { count: pins.length, defaultValue: '置顶 · {{count}} 条' })
    : t('chat.pin.tag', { defaultValue: '置顶' });

  return (
    <View style={styles.container} testID="pinned-message-banner">
      <ScrollingAnnouncementBanner
        icon={Pin}
        title=""
        body={preview}
        tag={tag}
        accessibilityLabel={t('chat.pin.bannerA11y', { preview, defaultValue: '置顶消息:{{preview}}' })}
        onPress={() => setListOpen(true)}
      />
      <PinnedMessagesSheet
        visible={listOpen}
        conversationID={conversationID}
        pins={pins}
        canManage={canManage}
        onClose={() => setListOpen(false)}
        onJump={onJump}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
});
